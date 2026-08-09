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

  -- Database-backed sessions, layered on top of (not replacing) the existing
  -- JWT expiry/token_version protections — see backend/src/security/sessions.ts
  -- and requireAuth in backend/src/auth.ts. Every regular-user JWT now carries
  -- a "sid" claim pointing at a row here; a token without one (i.e. every
  -- token issued before this migration) is rejected, so existing users need
  -- to log in once after this deploys. ON DELETE CASCADE means a user's
  -- sessions disappear automatically when their account does, as a backstop
  -- alongside the explicit deletes in both routes/me.ts's self-service
  -- account-deletion handler and routes/admin.ts's admin-initiated one
  -- (this codebase never relies solely on FK cascade for user data, since
  -- remote libSQL/Turso FK enforcement isn't guaranteed identical to local
  -- SQLite).
  CREATE TABLE IF NOT EXISTS user_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent TEXT NOT NULL DEFAULT '',
    ip_address TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
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

// Guards against two tabs/devices both creating an "open" shift (signed in,
// no sign-out yet) for the same user at nearly the same instant — the
// application-level check in routes/shifts.ts handles the ordinary case and
// returns a clean 409, but two requests landing close enough together could
// both pass that check before either commits. A partial unique index makes
// the *second* INSERT/UPDATE fail at the database level regardless of which
// of the two wins the race, which routes/shifts.ts catches and turns into
// the same 409 response.
//
// Run separately from the main executeMultiple schema block above (and
// wrapped in try/catch like the ALTER TABLE migrations here) because on a
// database that already has more than one open shift for some user — e.g.
// from before this fix existed — creating this index fails outright. That's
// a real data conflict this migration deliberately doesn't try to silently
// resolve (it would mean guessing which of two genuinely-open shifts to
// force-close). If it fails, the app keeps running on the application-level
// check alone rather than refusing to start.
try {
  await db.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_open_per_user ON shifts(user_id) WHERE sign_in IS NOT NULL AND sign_out IS NULL"
  );
} catch (e) {
  console.warn(
    "Could not create idx_shifts_one_open_per_user — at least one user likely already has more than one open shift. Falling back to the application-level check in routes/shifts.ts only.",
    e instanceof Error ? e.message : e
  );
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
