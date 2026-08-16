/**
 * Session policy constants and validation, in their own module because both
 * `db.ts` (the migrations) and `security/sessions.ts` need them and
 * `sessions.ts` already imports `db.ts` — putting them here keeps that from
 * becoming a cycle. Nothing in this file imports anything.
 */

/** Absolute lifetime. Matches the JWT's own expiry (`TOKEN_TTL` in
 * ../auth.ts): the session row and the token it backs expire together. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Absolute lifetime for a session while it is biometric-protected — see
 * `rotateSessionForBiometricProtection` in `security/sessions.ts` and
 * `PATCH /api/me/sessions/current` in `routes/me.ts`. Deliberately far
 * beyond SESSION_TTL_MS: once Face ID/Touch ID re-entry on this specific
 * device backs a session, that biometric check *is* the periodic
 * re-authentication event an absolute expiry otherwise exists to force, so
 * the ordinary 30-day ceiling no longer serves its purpose here (this was
 * an explicit, confirmed choice — scoped to biometric-protected sessions
 * only, not a global change to SESSION_TTL_MS, precisely because a
 * password-only or web session has no equivalent re-entry check backing
 * it).
 *
 * A session's JWT bakes in its own expiry at signing time, so upgrading (or
 * later downgrading) a session to/from this lifetime can't be done by
 * mutating a database column alone — it always mints a brand-new token; see
 * rotateSessionForBiometricProtection for why the old session is revoked in
 * the same breath a replacement is created, never left both-active.
 */
export const BIOMETRIC_SESSION_TTL_MS = 5 * 365 * 24 * 60 * 60 * 1000;

/**
 * Server-enforced idle timeout. A session whose `last_seen_at` is older than
 * this stops authenticating, full stop — the client can no longer be the
 * only thing deciding when an unattended session ends.
 *
 * `last_seen_at` is refreshed by any authenticated request (throttled, see
 * LAST_SEEN_THROTTLE_MS), so ordinary use — including the app's own
 * background refreshes — keeps a session alive. It is genuine inactivity
 * that ends it.
 */
export const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * How stale `last_seen_at` must be before an authenticated request bothers
 * rewriting it. Must stay comfortably below SESSION_IDLE_TIMEOUT_MS: at 5
 * minutes, a continuously-active session's stored timestamp is never more
 * than 5 minutes behind reality, so it can't drift into looking idle while
 * the app is actually in use.
 */
export const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

if (LAST_SEEN_THROTTLE_MS >= SESSION_IDLE_TIMEOUT_MS) {
  throw new Error(
    "LAST_SEEN_THROTTLE_MS must be shorter than SESSION_IDLE_TIMEOUT_MS, or an actively-used session will be logged out for looking idle."
  );
}

/**
 * Most simultaneously-signed-in installations one account may have. Passing
 * it doesn't reject the login — the least-recently-active *other*
 * installation is signed out instead, and the response says so, because
 * refusing a correct password with no explanation is indistinguishable from
 * a broken login.
 */
export const MAX_ACTIVE_INSTALLATIONS = 10;

/** A v4 UUID is 36 characters; the cap is deliberately close to that so a
 * client can't push megabytes of "installation id" into the database. */
export const DEVICE_INSTALLATION_ID_MAX_LENGTH = 64;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a-f][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Installation ids come from the client and are stored, so they're validated
 * like any other untrusted input. The format is fixed (a UUID the client
 * generated once) rather than free text, which means there is nothing to
 * sanitise — anything that isn't a UUID is simply not one, and is rejected
 * rather than trimmed into something that looks plausible.
 *
 * It is not a secret and not a credential: knowing another installation's id
 * grants nothing, because every lookup is scoped to the authenticated user.
 */
export function isValidDeviceInstallationId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length > DEVICE_INSTALLATION_ID_MAX_LENGTH) return false;
  return UUID_PATTERN.test(value);
}

/** Cut-off timestamps for the two independent expiry rules, as ISO strings
 * ready for comparison against the stored columns. */
export function sessionCutoffs(now: number = Date.now()): { idleBefore: string; expiredAtOrBefore: string } {
  return {
    idleBefore: new Date(now - SESSION_IDLE_TIMEOUT_MS).toISOString(),
    expiredAtOrBefore: new Date(now).toISOString(),
  };
}
