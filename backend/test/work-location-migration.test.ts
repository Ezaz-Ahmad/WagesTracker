import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("legacy work-location migration", () => {
  const dbPath = path.join(os.tmpdir(), `wagetracker-work-location-migration-${randomUUID()}.sqlite`);

  beforeAll(async () => {
    const legacy = createClient({ url: `file:${dbPath}` });
    await legacy.executeMultiple(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        address TEXT NOT NULL DEFAULT '',
        work_location_name TEXT NOT NULL DEFAULT '',
        work_address TEXT NOT NULL DEFAULT '',
        multiple_locations INTEGER NOT NULL DEFAULT 0,
        other_locations TEXT NOT NULL DEFAULT '',
        week_starts_on TEXT NOT NULL DEFAULT 'Monday',
        rate REAL NOT NULL DEFAULT 18.5,
        goal_hours REAL NOT NULL DEFAULT 35,
        goal_earnings REAL NOT NULL DEFAULT 647.5,
        token_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE shifts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        sign_in TEXT,
        sign_out TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE day_expenses (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        fuel_cost REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, date)
      );
      INSERT INTO users (id, name, email, password_hash, work_location_name, work_address, other_locations, created_at)
        VALUES ('legacy-user', 'Legacy User', 'legacy@example.com', 'unused', ' Main   Office ', '1 Main St', 'Configured Site', '2025-01-01T00:00:00.000Z');
      INSERT INTO shifts (id, user_id, date, location, sign_in, sign_out, created_at, updated_at)
        VALUES ('shift-main', 'legacy-user', '2026-08-10', 'MAIN OFFICE', '09:00', '10:00', '2026-08-10T00:00:00.000Z', '2026-08-10T00:00:00.000Z');
      INSERT INTO shifts (id, user_id, date, location, sign_in, sign_out, created_at, updated_at)
        VALUES ('shift-legacy', 'legacy-user', '2026-08-11', 'Legacy   Site', '09:00', '10:00', '2026-08-11T00:00:00.000Z', '2026-08-11T00:00:00.000Z');
      INSERT INTO day_expenses(id,user_id,date,fuel_cost,created_at,updated_at)
        VALUES('legacy-fuel','legacy-user','2026-08-10',12.5,'2026-08-10','2026-08-10');
      CREATE TABLE week_extras(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),week_start TEXT NOT NULL,amount REAL NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,week_start));
      INSERT INTO week_extras VALUES('legacy-extra','legacy-user','2026-08-10',25,'Existing bonus','2026-08-10','2026-08-10');
    `);
    legacy.close();
    process.env.DB_PATH = dbPath;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    process.env.NODE_ENV = "test";
  });

  afterAll(() => {
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.rmSync(dbPath + suffix, { force: true }); } catch { /* best effort */ }
    }
  });

  it("creates stable rows, archives historical-only names, and links every old shift", async () => {
    const { db } = await import("../src/db.js");
    const locations = await db.execute({
      sql: "SELECT name, normalized_name, archived_at FROM work_locations WHERE user_id = ? ORDER BY normalized_name",
      args: ["legacy-user"],
    });
    expect(locations.rows).toHaveLength(3);
    expect(locations.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Main Office", normalized_name: "job_legacy-user:main office", archived_at: null }),
      expect.objectContaining({ name: "Configured Site", normalized_name: "job_legacy-user:configured site", archived_at: null }),
      expect.objectContaining({ name: "Legacy Site", normalized_name: "job_legacy-user:legacy site" }),
    ]));
    const legacyOnly = locations.rows.find((row) => row.normalized_name === "job_legacy-user:legacy site");
    expect(legacyOnly?.archived_at).toEqual(expect.any(String));

    const shifts = await db.execute({
      sql: "SELECT id, location, location_snapshot, work_location_id FROM shifts ORDER BY id",
      args: [],
    });
    expect(shifts.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "shift-main", location: "MAIN OFFICE", location_snapshot: "MAIN OFFICE" }),
      expect.objectContaining({ id: "shift-legacy", location: "Legacy   Site", location_snapshot: "Legacy   Site" }),
    ]));
    expect(shifts.rows.every((row) => typeof row.work_location_id === "string")).toBe(true);
    const {migrateJobs}=await import("../src/jobMigration.js");
    await migrateJobs(db);await migrateJobs(db);
    const jobs=await db.execute("SELECT id,name FROM jobs");expect(jobs.rows).toHaveLength(1);expect(jobs.rows[0].id).toBe("job_legacy-user");
    const saved=await db.execute("SELECT job_id,applied_rate_cents FROM shifts");expect(saved.rows.every(r=>r.job_id==="job_legacy-user"&&r.applied_rate_cents===1850)).toBe(true);
    expect((await db.execute("SELECT job_id,fuel_cost FROM day_expenses")).rows).toEqual([{job_id:"job_legacy-user",fuel_cost:12.5}]);
    expect((await db.execute("SELECT job_id,amount,reason,effective_date FROM week_extras")).rows).toEqual([{job_id:"job_legacy-user",amount:25,reason:"Existing bonus",effective_date:"2026-08-16"}]);
    db.close();
  });
});
