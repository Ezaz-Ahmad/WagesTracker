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

  -- Personal spending is deliberately separate from work-related
  -- day_expenses. Amounts are integer cents and spent_date is the plain
  -- local calendar date the user confirmed, so filtering can never move a
  -- purchase across a day because of a UTC conversion.
  CREATE TABLE IF NOT EXISTS spending_categories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    colour TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    seed_key TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, seed_key)
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_spending_categories_active_name
    ON spending_categories(user_id, lower(name)) WHERE archived_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_spending_categories_user
    ON spending_categories(user_id, archived_at, name);

  CREATE TABLE IF NOT EXISTS personal_expenses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES spending_categories(id) ON DELETE RESTRICT,
    amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
    spent_at TEXT NOT NULL,
    spent_date TEXT NOT NULL,
    time_zone TEXT NOT NULL,
    merchant TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    payment_method TEXT,
    client_request_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(user_id, client_request_id)
  );

  CREATE INDEX IF NOT EXISTS idx_personal_expenses_user_date
    ON personal_expenses(user_id, spent_date DESC, spent_at DESC);
  CREATE INDEX IF NOT EXISTS idx_personal_expenses_user_category_date
    ON personal_expenses(user_id, category_id, spent_date DESC);

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
    revoked_at TEXT,
    biometric_protected INTEGER NOT NULL DEFAULT 0
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

// — Session device-installation migrations —
//
// Before these, every successful login inserted a fresh `user_sessions` row
// with nothing tying it to the device it came from, so logging in ten times
// from one installed PWA produced ten identical "Safari on iOS" entries in
// Settings. `device_installation_id` is a random UUID the client generates
// once per installation (see the frontend's lib/deviceInstallation.ts) and
// sends with login/signup; it is not a secret and not a credential, it just
// lets the server recognise "this is the same installation signing in
// again" and retire the previous session for it.
//
// Nullable on purpose: rows created before this existed have no installation
// id and must not be guessed at retroactively — inferring device identity
// from IP address and user-agent would happily merge two different phones on
// one home Wi-Fi.
try {
  await db.execute("ALTER TABLE user_sessions ADD COLUMN device_installation_id TEXT");
} catch {
  // already migrated
}
try {
  await db.execute("ALTER TABLE user_sessions ADD COLUMN device_name TEXT NOT NULL DEFAULT ''");
} catch {
  // already migrated
}

// A session marked biometric-protected is exempt from the idle timeout in
// validateSession (see security/sessions.ts) — Face ID/Touch ID re-entry on
// that device substitutes for the "kill an unattended session" protection
// the idle timeout otherwise provides, rather than sitting behind it. Set by
// PATCH /api/me/sessions/current when the frontend turns biometric login on
// (see routes/me.ts), cleared the same way when it's turned off. A brand-new
// session created by a fresh password login always starts unprotected —
// re-enabling biometric login on that new token is what (re-)marks it, the
// same one-time step already required to store a fresh Keychain credential.
try {
  await db.execute("ALTER TABLE user_sessions ADD COLUMN biometric_protected INTEGER NOT NULL DEFAULT 0");
} catch {
  // already migrated
}

// Supports the one lookup the login path does on every sign-in: "the active
// sessions for this user and this installation".
try {
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_user_sessions_installation ON user_sessions(user_id, device_installation_id, revoked_at)"
  );
} catch (e) {
  console.warn("Could not create idx_user_sessions_installation.", e instanceof Error ? e.message : e);
}

// One-time cleanup of the duplicates the old behaviour accumulated. Keeps
// the most recently active session per (user, installation) — and for legacy
// rows, which all share a NULL installation id, the most recently active per
// user — so nobody is signed out of the device they are currently holding,
// then revokes the rest. Absolutely-expired rows are swept at the same time.
//
// Deliberately conservative: legacy rows are grouped only by user, never by
// IP address or user-agent. Two of the user's real devices might collapse
// into one entry here, and they will separate again the moment each of them
// signs in under the new scheme. Idle expiry is NOT applied as a revocation
// here — it's enforced at validation time instead, so deploying this doesn't
// sign everyone out of a session they were about to come back to.
try {
  const nowIso = new Date().toISOString();
  await db.execute({
    sql: `UPDATE user_sessions SET revoked_at = ? WHERE revoked_at IS NULL AND expires_at <= ?`,
    args: [nowIso, nowIso],
  });
  await db.execute({
    sql: `UPDATE user_sessions
          SET revoked_at = ?
          WHERE revoked_at IS NULL
            AND id NOT IN (
              SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                  PARTITION BY user_id, COALESCE(device_installation_id, '')
                  ORDER BY last_seen_at DESC, created_at DESC, id DESC
                ) AS rn
                FROM user_sessions
                WHERE revoked_at IS NULL
              ) ranked WHERE ranked.rn = 1
            )`,
    args: [nowIso],
  });
} catch (e) {
  console.warn(
    "Could not run the one-time duplicate-session cleanup. The app still works; the sessions list may show historical duplicates until they expire.",
    e instanceof Error ? e.message : e
  );
}

// "At most one active session per installation" as a database constraint, so
// two logins racing from the same installation cannot both end up inserting
// a row — whichever loses the race fails here and retries (see
// createSession in security/sessions.ts) rather than quietly leaving a
// duplicate behind. Application-level revoke-then-insert alone can't
// guarantee that, however carefully it's written.
//
// Runs after the cleanup above, which is what makes it able to build. NULL
// installation ids are exempt (SQLite treats NULLs as distinct in a unique
// index, and the predicate says so explicitly) so legacy rows never collide.
// Same fallback posture as idx_shifts_one_open_per_user above: if it can't
// be created, the app keeps running on the transactional path alone.
try {
  await db.execute(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_user_sessions_one_active_per_installation
     ON user_sessions(user_id, device_installation_id)
     WHERE revoked_at IS NULL AND device_installation_id IS NOT NULL`
  );
} catch (e) {
  console.warn(
    "Could not create idx_user_sessions_one_active_per_installation — some user likely still has two active sessions for one installation. Falling back to the transactional revoke-then-insert in security/sessions.ts only.",
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
