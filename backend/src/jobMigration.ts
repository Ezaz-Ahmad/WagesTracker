import type { Client, Transaction } from "@libsql/client";

type Executor = Pick<Client, "execute"> | Pick<Transaction, "execute">;

/** Also used for accounts created after deployment. The stable primary id
 * makes concurrent requests and an interrupted migration safe to retry. */
export async function ensureUserJob(
  database: Executor,
  userId: string
): Promise<void> {
  await database.execute({
    sql: `INSERT OR IGNORE INTO jobs
      (id,user_id,name,role,week_starts_on,goal_hours,goal_earnings,smart_reminders_enabled,is_primary,created_at,updated_at)
      SELECT 'job_' || id,id,CASE WHEN trim(work_location_name)='' THEN 'My job' ELSE work_location_name END,
        '',week_starts_on,goal_hours,goal_earnings,smart_reminders_enabled,1,created_at,created_at FROM users WHERE id=?`,
    args: [userId],
  });
  await database.execute({
    sql: `INSERT OR IGNORE INTO pay_rates(id,user_id,job_id,location_id,effective_from,rate_cents,created_at)
      SELECT 'rate_' || id,id,'job_' || id,NULL,'0001-01-01',CAST(round(rate*100) AS INTEGER),created_at
      FROM users WHERE id=?`,
    args: [userId],
  });
  await database.execute({
    sql: "UPDATE work_locations SET normalized_name='job_' || user_id || ':' || normalized_name WHERE user_id=? AND job_id IS NULL",
    args: [userId],
  });
  for (const table of [
    "shifts",
    "work_locations",
    "day_expenses",
    "week_extras",
  ]) {
    await database.execute({
      sql: `UPDATE ${table} SET job_id='job_' || user_id WHERE user_id=? AND job_id IS NULL`,
      args: [userId],
    });
  }
  await database.execute({
    sql: `UPDATE shifts SET applied_rate_cents=(SELECT CAST(round(rate*100) AS INTEGER) FROM users WHERE id=shifts.user_id),
      rate_source='job',job_name_snapshot=(SELECT name FROM jobs WHERE id=shifts.job_id)
      WHERE user_id=? AND applied_rate_cents IS NULL`,
    args: [userId],
  });
}

export async function migrateJobs(db: Client): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,role TEXT NOT NULL DEFAULT '',week_starts_on TEXT NOT NULL DEFAULT 'Monday',
      goal_hours REAL NOT NULL DEFAULT 0,goal_earnings REAL NOT NULL DEFAULT 0,
      smart_reminders_enabled INTEGER NOT NULL DEFAULT 0,is_primary INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_primary ON jobs(user_id) WHERE is_primary=1;
    CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id,archived_at);
    CREATE TABLE IF NOT EXISTS pay_rates (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      location_id TEXT REFERENCES work_locations(id) ON DELETE CASCADE,
      effective_from TEXT NOT NULL,rate_cents INTEGER CHECK(rate_cents IS NULL OR rate_cents BETWEEN 0 AND 100000),
      created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_rate_date ON pay_rates(job_id,effective_from) WHERE location_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_location_rate_date ON pay_rates(location_id,effective_from) WHERE location_id IS NOT NULL;
  `);
  for (const table of ["shifts", "work_locations"]) {
    const columns = await db.execute(`PRAGMA table_info(${table})`);
    if (!columns.rows.some((r) => r.name === "job_id"))
      await db.execute(`ALTER TABLE ${table} ADD COLUMN job_id TEXT`);
  }
  for (const [name, type] of [
    ["applied_rate_cents", "INTEGER"],
    ["rate_source", "TEXT"],
    ["job_name_snapshot", "TEXT"],
  ]) {
    const columns = await db.execute("PRAGMA table_info(shifts)");
    if (!columns.rows.some((r) => r.name === name))
      await db.execute(`ALTER TABLE shifts ADD COLUMN ${name} ${type}`);
  }
  const userColumns = await db.execute("PRAGMA table_info(users)");
  if (!userColumns.rows.some((r) => r.name === "combined_goal_earnings"))
    await db.execute(
      "ALTER TABLE users ADD COLUMN combined_goal_earnings REAL NOT NULL DEFAULT 0"
    );
  const expenseColumns = await db.execute(
    "PRAGMA table_info(personal_expenses)"
  );
  if (!expenseColumns.rows.some((r) => r.name === "job_id"))
    await db.execute("ALTER TABLE personal_expenses ADD COLUMN job_id TEXT");
  const done = await db.execute(
    "SELECT version FROM schema_migrations WHERE version='multi_job_pay_v1'"
  );
  if (!done.rows.length) {
    const tx = await db.transaction("write");
    try {
      const completed = await tx.execute(
        "SELECT version FROM schema_migrations WHERE version='multi_job_pay_v1'"
      );
      if (completed.rows.length) {
        await tx.commit();
        return;
      }
      // These tables have no incoming foreign keys. Replace their original
      // user/date uniqueness with job/date uniqueness in one atomic transaction.
      await tx.execute(`CREATE TABLE day_expenses_jobs (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,job_id TEXT,
      date TEXT NOT NULL,fuel_cost REAL NOT NULL DEFAULT 0,automatic_fuel_cents INTEGER NOT NULL DEFAULT 0,
      manual_override_cents INTEGER,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,job_id,date))`);
      await tx.execute(`INSERT INTO day_expenses_jobs(id,user_id,job_id,date,fuel_cost,automatic_fuel_cents,manual_override_cents,created_at,updated_at)
      SELECT id,user_id,'job_' || user_id,date,fuel_cost,automatic_fuel_cents,manual_override_cents,created_at,updated_at FROM day_expenses`);
      await tx.execute("DROP TABLE day_expenses");
      await tx.execute("ALTER TABLE day_expenses_jobs RENAME TO day_expenses");
      await tx.execute(`CREATE TABLE week_extras_jobs (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,job_id TEXT,
      week_start TEXT NOT NULL,effective_date TEXT NOT NULL,amount REAL NOT NULL DEFAULT 0,reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,job_id,week_start))`);
      await tx.execute(`INSERT INTO week_extras_jobs(id,user_id,job_id,week_start,effective_date,amount,reason,created_at,updated_at)
      SELECT id,user_id,'job_' || user_id,week_start,effective_date,amount,reason,created_at,updated_at FROM week_extras`);
      await tx.execute("DROP TABLE week_extras");
      await tx.execute("ALTER TABLE week_extras_jobs RENAME TO week_extras");
      const users = await tx.execute("SELECT id FROM users");
      for (const row of users.rows) await ensureUserJob(tx, String(row.id));
      // Preserve the original uniqueness guard while allowing the same branch
      // name at different employers. Display names remain untouched.
      await tx.execute(
        "UPDATE work_locations SET normalized_name=job_id || ':' || normalized_name WHERE substr(normalized_name,1,length(job_id)+1)!=job_id || ':'"
      );
      await tx.execute({
        sql: "INSERT INTO schema_migrations(version,applied_at) VALUES('multi_job_pay_v1',?)",
        args: [new Date().toISOString()],
      });
      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  }
  await db.executeMultiple(`
    CREATE INDEX IF NOT EXISTS idx_shifts_job_date ON shifts(user_id,job_id,date);
    CREATE INDEX IF NOT EXISTS idx_day_expenses_job_date ON day_expenses(user_id,job_id,date);
    CREATE INDEX IF NOT EXISTS idx_week_extras_job_week ON week_extras(user_id,job_id,week_start);
    CREATE INDEX IF NOT EXISTS idx_week_extras_job_effective_date ON week_extras(user_id,job_id,effective_date);
    CREATE INDEX IF NOT EXISTS idx_spending_job ON personal_expenses(user_id,job_id,spent_date);
  `);
}
