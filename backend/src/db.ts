import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";

// Local/dev default: a plain SQLite file on disk, same as before.
//
// In production, set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) to a hosted libSQL/Turso
// database instead. This matters because most PaaS filesystems (Render's free plan
// included) are ephemeral — a local file gets wiped on every restart/redeploy. Turso is
// SQLite-compatible (same schema, same SQL below), just accessed over the network, so
// data survives deploys. See README for setup.
const DB_PATH = process.env.DB_PATH || "./data/wage-tracker.sqlite";
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}

export const db: Client = createClient(
  TURSO_URL ? { url: TURSO_URL, authToken: TURSO_AUTH_TOKEN } : { url: `file:${DB_PATH}` }
);

// Top-level await: any module that imports `db` from here waits for the schema to exist
// before it runs, so route handlers never race the initial CREATE TABLE calls.
await db.executeMultiple(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
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

  CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    sign_in TEXT,
    sign_out TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_shifts_user_date ON shifts(user_id, date);

  CREATE TABLE IF NOT EXISTS day_expenses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    fuel_cost REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, date)
  );

  CREATE INDEX IF NOT EXISTS idx_day_expenses_user_date ON day_expenses(user_id, date);

  CREATE TABLE IF NOT EXISTS week_extras (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start TEXT NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, week_start)
  );

  CREATE INDEX IF NOT EXISTS idx_week_extras_user_week ON week_extras(user_id, week_start);
`);

// An earlier iteration of day_expenses briefly had an `other_earning` column
// (per-day) before that concept moved to the week-level `week_extras` table
// above. Nothing reads or writes it anymore; left in place rather than
// attempting a DROP COLUMN migration, which is riskier than an unused column.

// Migration for databases created before `users.address` existed (the table
// definition above only applies to brand-new databases via CREATE TABLE IF
// NOT EXISTS). Fails harmlessly with "duplicate column" if already migrated.
try {
  await db.execute("ALTER TABLE users ADD COLUMN address TEXT NOT NULL DEFAULT ''");
} catch {
  // already migrated
}

// Migration for databases created before `users.token_version` existed.
// Every pre-existing account defaults to 0 (matching brand-new signups), so
// their existing JWTs — which were minted before this column existed and
// therefore carry no tokenVersion claim — keep working: requireAuth treats a
// missing claim as tokenVersion 0, and this migration guarantees the stored
// value starts at 0 too. Fails harmlessly with "duplicate column" if already
// migrated.
try {
  await db.execute("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
} catch {
  // already migrated
}

export const RETENTION_YEARS = 5;

export async function pruneExpiredShifts(): Promise<void> {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  await db.execute({ sql: "DELETE FROM shifts WHERE date < ?", args: [cutoffKey] });
  await db.execute({ sql: "DELETE FROM day_expenses WHERE date < ?", args: [cutoffKey] });
  await db.execute({ sql: "DELETE FROM week_extras WHERE week_start < ?", args: [cutoffKey] });
}
