import { randomUUID } from "node:crypto";
import type { Request } from "express";
import { db } from "../db.js";
import type { InStatement } from "@libsql/client";
import type { UserSessionRow } from "../types.js";
import {
  LAST_SEEN_THROTTLE_MS,
  MAX_ACTIVE_INSTALLATIONS,
  SESSION_TTL_MS,
  isValidDeviceInstallationId,
  sessionCutoffs,
} from "./sessionPolicy.js";

/**
 * Database-backed sessions, layered on top of (not replacing) the existing
 * JWT signature/expiry/`token_version` protections — see `requireAuth` in
 * `../auth.ts`. A JWT alone can't be individually revoked before it expires;
 * a row here can. Every regular-user JWT carries a `sid` claim pointing at
 * exactly one row in `user_sessions`, and `requireAuth` treats the JWT as
 * invalid unless that row still exists, is unrevoked, unexpired, not idle,
 * and belongs to the same user the JWT claims to be.
 *
 * The raw JWT itself is never stored here or anywhere else — only the
 * session id it carries. There would be nothing to gain from storing the
 * token (it's self-verifying via its signature) and real cost to storing it
 * (a stolen database dump would hand over live, directly usable credentials
 * instead of an opaque id).
 *
 * Each row also records which *installation* it belongs to — see
 * `device_installation_id` in ../db.ts. That's what stops one phone from
 * accumulating a new "Safari on iOS" entry in Settings on every login: the
 * installation's previous session is revoked as the new one is created, in
 * a single transaction, so there is only ever one active session per
 * installation.
 */

export { SESSION_TTL_MS };

const MAX_USER_AGENT_LENGTH = 300;
const MAX_IP_ADDRESS_LENGTH = 64;
const MAX_DEVICE_NAME_LENGTH = 80;

/** Strips control characters and caps length. Both user-agent and IP are
 * attacker-influenced input (arbitrary request headers) that get stored and
 * later rendered back to the user verbatim in Settings, so this is the only
 * thing standing between a crafted header and garbage in the sessions list —
 * length alone isn't the only concern, stray control/newline characters
 * aren't either. */
function sanitize(raw: string | undefined | null, maxLength: number): string {
  if (!raw) return "";
  return raw.replace(/[\x00-\x1F\x7F]/g, "").trim().slice(0, maxLength);
}

/** Pulls a best-effort user-agent and client IP off a request. `app.ts` sets
 * `trust proxy` to 1 hop, so `req.ip` already resolves through a single
 * `X-Forwarded-For` layer (Render's own proxy) to the real client address;
 * this never talks to an external geolocation service and never derives a
 * physical location — just the address itself, for the user's own security
 * review (see the Security & Sessions section in Settings).
 *
 * Note what this is NOT used for: device identity. IP address and user-agent
 * are display detail only. Two phones on one home Wi-Fi share an IP and may
 * send byte-identical user-agent strings, and the same phone changes IP
 * every time it moves between Wi-Fi and mobile data — neither can tell one
 * installation from another, which is why `device_installation_id` exists.
 */
export function extractClientInfo(req: Request): { userAgent: string; ipAddress: string } {
  return {
    userAgent: sanitize(req.headers["user-agent"], MAX_USER_AGENT_LENGTH),
    ipAddress: sanitize(req.ip ?? req.socket?.remoteAddress ?? "", MAX_IP_ADDRESS_LENGTH),
  };
}

export interface CreateSessionInput {
  userId: string;
  userAgent: string;
  ipAddress: string;
  /** The client's per-installation UUID, already validated by the route.
   * Null for callers that don't send one (older clients), which keeps them
   * working exactly as before — every login just makes its own session. */
  deviceInstallationId?: string | null;
  /** Optional user-supplied label. Cosmetic only. */
  deviceName?: string | null;
}

export interface CreateSessionResult {
  sessionId: string;
  /** How many *other* installations were signed out to stay within
   * MAX_ACTIVE_INSTALLATIONS. The route surfaces this so a user who hits the
   * limit is told what happened instead of silently losing a device. */
  evictedForLimit: number;
}

function isUniqueConstraintError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(message);
}

/**
 * Which sessions would have to go to keep this user within the installation
 * limit once the incoming one is added. Counted in application code rather
 * than SQL because the limit is a courtesy, not a security boundary — the
 * worst case if two logins race here is briefly allowing an eleventh
 * session, which the next login corrects.
 */
async function sessionsToEvictForLimit(userId: string, incomingInstallationId: string | null): Promise<string[]> {
  const { expiredAtOrBefore, idleBefore } = sessionCutoffs();
  const result = await db.execute({
    sql: `SELECT id FROM user_sessions
          WHERE user_id = ?
            AND revoked_at IS NULL
            AND expires_at > ?
            AND last_seen_at > ?
            AND (device_installation_id IS NULL OR device_installation_id IS NOT ?)
          ORDER BY last_seen_at ASC`,
    args: [userId, expiredAtOrBefore, idleBefore, incomingInstallationId],
  });
  const others = result.rows.map((row) => String((row as unknown as { id: string }).id));
  const overflow = others.length + 1 - MAX_ACTIVE_INSTALLATIONS;
  return overflow > 0 ? others.slice(0, overflow) : [];
}

/**
 * Creates the session row for a freshly issued token (signup, login, or the
 * replacement token after a password change) and returns its id, ready to
 * embed as the JWT's `sid` claim.
 *
 * When an installation id is supplied, the previous session for that
 * installation is revoked *in the same write batch* as the new row is
 * inserted, so the two can never be observed both-active or both-gone. That
 * is a rotation, not a reuse: a brand-new session id and a brand-new JWT,
 * with the old one invalidated. Reusing the old token would defeat the point
 * of logging in again.
 *
 * The unique index in ../db.ts backs this up at the storage layer. If a
 * concurrent login from the same installation wins the race, the INSERT here
 * fails on that constraint and the whole thing is retried — at which point
 * the revoke half sees the competitor's row and clears it. That's why this
 * can't leave duplicates behind the way a plain SELECT-then-INSERT can.
 */
export async function createSession(input: CreateSessionInput): Promise<CreateSessionResult> {
  const installationId = isValidDeviceInstallationId(input.deviceInstallationId)
    ? input.deviceInstallationId
    : null;
  const deviceName = sanitize(input.deviceName, MAX_DEVICE_NAME_LENGTH);

  const evictions = await sessionsToEvictForLimit(input.userId, installationId);

  const attempt = async (): Promise<string> => {
    const id = randomUUID();
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    const statements: InStatement[] = [];

    if (installationId) {
      statements.push({
        sql: `UPDATE user_sessions SET revoked_at = ?
              WHERE user_id = ? AND device_installation_id = ? AND revoked_at IS NULL`,
        args: [nowIso, input.userId, installationId],
      });
    }

    for (const evictedId of evictions) {
      statements.push({
        sql: "UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
        args: [nowIso, evictedId],
      });
    }

    statements.push({
      sql: `INSERT INTO user_sessions
              (id, user_id, user_agent, ip_address, created_at, last_seen_at, expires_at, device_installation_id, device_name)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        id,
        input.userId,
        input.userAgent,
        input.ipAddress,
        nowIso,
        nowIso,
        expiresAt,
        installationId,
        deviceName,
      ],
    });

    await db.batch(statements, "write");
    return id;
  };

  try {
    return { sessionId: await attempt(), evictedForLimit: evictions.length };
  } catch (error) {
    // Lost a race with a simultaneous login from the same installation. The
    // retry's revoke step now sees the winner's row, clears it, and inserts
    // cleanly — leaving exactly one active session, which is the invariant
    // this whole path exists to hold.
    if (installationId && isUniqueConstraintError(error)) {
      return { sessionId: await attempt(), evictedForLimit: evictions.length };
    }
    throw error;
  }
}

export interface SessionValidationResult {
  valid: boolean;
  lastSeenAt?: string;
}

/**
 * The single check requireAuth relies on. A JOIN against `users` in one
 * query covers most of the "should this request succeed" checklist at once:
 * no row back at all means the session doesn't exist, doesn't belong to
 * this user, or the user itself no longer exists (an inner join can't match
 * a deleted user) — all three collapse to the same generic rejection by
 * design, since which one it was is never revealed to the caller.
 *
 * Idle expiry is enforced here rather than by a background sweep, so it
 * applies the instant it's true: there is no window in which an abandoned
 * session still authenticates because a cleanup job hasn't run yet.
 *
 * A session marked `biometric_protected` (see PATCH /api/me/sessions/current
 * in routes/me.ts) is exempt from that idle check specifically — Face
 * ID/Touch ID re-entry on that device is itself the "was this really the
 * account owner" check an idle timeout otherwise exists to approximate, so
 * requiring both would just mean Face ID quietly stops working after 10
 * minutes of the app merely sitting in the background. The absolute
 * lifetime (`expires_at`), revocation, and token-version checks below still
 * apply unconditionally — this is narrowly an idle-timeout exemption, not a
 * way to make a session unkillable.
 */
export async function validateSession(
  sessionId: string,
  userId: string,
  tokenVersion: number
): Promise<SessionValidationResult> {
  const result = await db.execute({
    sql: `SELECT s.last_seen_at as last_seen_at, s.revoked_at as revoked_at, s.expires_at as expires_at,
                 s.biometric_protected as biometric_protected, u.token_version as token_version
          FROM user_sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.id = ? AND s.user_id = ?`,
    args: [sessionId, userId],
  });
  const row = result.rows[0] as unknown as
    | {
        last_seen_at: string;
        revoked_at: string | null;
        expires_at: string;
        biometric_protected: number;
        token_version: number;
      }
    | undefined;
  if (!row) return { valid: false };
  if (row.revoked_at) return { valid: false };
  const { expiredAtOrBefore, idleBefore } = sessionCutoffs();
  if (row.expires_at <= expiredAtOrBefore) return { valid: false };
  if (!row.biometric_protected && row.last_seen_at <= idleBefore) return { valid: false };
  if (Number(row.token_version) !== tokenVersion) return { valid: false };
  return { valid: true, lastSeenAt: row.last_seen_at };
}

/**
 * Marks (or unmarks) the caller's own current session as biometric-
 * protected — see validateSession's idle-exemption above. Scoped to
 * `sessionId + userId` the same way every other single-session mutation in
 * this file is, even though the route only ever passes the caller's own
 * `req.sessionId`: defense in depth against a future call site passing the
 * wrong id, not a currently-reachable cross-user path.
 *
 * Deliberately does not touch `last_seen_at`, `expires_at`, or anything
 * else — turning biometric login on or off is not itself session activity,
 * and must not silently extend or shorten the session's own lifetime.
 */
export async function setSessionBiometricProtection(
  sessionId: string,
  userId: string,
  protectedFlag: boolean
): Promise<void> {
  await db.execute({
    sql: "UPDATE user_sessions SET biometric_protected = ? WHERE id = ? AND user_id = ?",
    args: [protectedFlag ? 1 : 0, sessionId, userId],
  });
}

/**
 * Bumps `last_seen_at` to now, but only if the stored value is already more
 * than LAST_SEEN_THROTTLE_MS old — every authenticated request would
 * otherwise mean a write on every single request, for information that's
 * only ever shown to the user rounded to a rough "last active" time anyway.
 * The throttle is checked against the idle timeout at module load (see
 * sessionPolicy.ts) so it can never be widened past the point where an
 * in-use session would look idle.
 */
export async function touchSessionIfStale(sessionId: string, lastSeenAt: string): Promise<void> {
  const last = new Date(lastSeenAt).getTime();
  if (Date.now() - last < LAST_SEEN_THROTTLE_MS) return;
  await db.execute({
    sql: "UPDATE user_sessions SET last_seen_at = ? WHERE id = ?",
    args: [new Date().toISOString(), sessionId],
  });
}

/**
 * Only the caller's own genuinely-active sessions — unrevoked, within the
 * absolute lifetime, and not idle-expired — for the Settings "Security &
 * Sessions" list. All three filters matter: a list that shows sessions which
 * would be rejected on their next request is worse than useless, because the
 * whole point of the screen is telling the user what is currently signed in.
 *
 * Ordered newest-active first; the route pins the current session to the top
 * afterwards, since "which is current" is the caller's session id, not a
 * property of the row.
 */
export async function listSessionsForUser(userId: string): Promise<UserSessionRow[]> {
  const { expiredAtOrBefore, idleBefore } = sessionCutoffs();
  const result = await db.execute({
    sql: `SELECT * FROM user_sessions
          WHERE user_id = ?
            AND revoked_at IS NULL
            AND expires_at > ?
            AND last_seen_at > ?
          ORDER BY last_seen_at DESC`,
    args: [userId, expiredAtOrBefore, idleBefore],
  });
  return result.rows as unknown as UserSessionRow[];
}

/** Existence + ownership check, used before revoking a single session by id
 * so the route can return a 404 for both "doesn't exist" and "belongs to
 * someone else" — the same response either way, so a caller can't use this
 * endpoint to probe which session ids are real. */
export async function sessionBelongsToUser(sessionId: string, userId: string): Promise<boolean> {
  const result = await db.execute({
    sql: "SELECT 1 FROM user_sessions WHERE id = ? AND user_id = ?",
    args: [sessionId, userId],
  });
  return result.rows.length > 0;
}

/** Revokes a single session by id. Callers must check sessionBelongsToUser
 * (or equivalent) first — this does not re-check ownership itself. */
export async function revokeSessionById(sessionId: string): Promise<void> {
  await db.execute({
    sql: "UPDATE user_sessions SET revoked_at = ? WHERE id = ?",
    args: [new Date().toISOString(), sessionId],
  });
}

/** Revokes every one of a user's sessions except the one given — the
 * "log out all other devices" action. */
export async function revokeOtherSessions(userId: string, currentSessionId: string): Promise<void> {
  await db.execute({
    sql: "UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL",
    args: [new Date().toISOString(), userId, currentSessionId],
  });
}
