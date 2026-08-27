import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { timingSafeEqual } from "node:crypto";
import { applicationSecret } from "./config/secrets.js";
import { touchSessionIfStale, validateSession } from "./security/sessions.js";

const JWT_SECRET = applicationSecret();
const TOKEN_TTL = "30d";

export interface AuthedRequest extends Request {
  userId?: string;
  /** The database session (`user_sessions.id`) this request's JWT was
   * validated against — set by requireAuth, never taken from anything the
   * client sends. Route handlers use this (not a client-supplied value) to
   * know which session is "current" for things like the sessions list and
   * "log out all other devices". */
  sessionId?: string;
}

interface RegularUserTokenPayload {
  sub: string;
  tokenVersion: number;
  sid: string;
}

/**
 * Regular-user JWTs carry two independent revocation mechanisms, both
 * checked by requireAuth below on every request:
 *
 *   - `tokenVersion`, mirroring `users.token_version` — bumped on every
 *     password change, instantly invalidating every token issued before it,
 *     everywhere, all at once.
 *   - `sid`, pointing at a row in `user_sessions` — lets one specific
 *     session be revoked individually (see Settings' "Security & Sessions"),
 *     without touching any of the user's other logged-in devices.
 *
 * A token is only ever valid while both checks pass. Neither replaces the
 * JWT's own signature/expiry check; both are layered on top of it.
 *
 * `ttlOverrideMs`, when given, replaces the ordinary TOKEN_TTL for this one
 * token — used exclusively for the biometric-protected session upgrade (see
 * BIOMETRIC_SESSION_TTL_MS in security/sessionPolicy.ts and
 * rotateSessionForBiometricProtection in security/sessions.ts). A JWT's
 * `exp` claim is baked in at signing time and can never be extended later by
 * a database write alone, which is why that flow mints a brand-new token
 * through here rather than just updating the session row.
 */
export function signToken(
  userId: string,
  tokenVersion: number,
  sessionId: string,
  ttlOverrideMs?: number
): string {
  const payload: RegularUserTokenPayload = { sub: userId, tokenVersion, sid: sessionId };
  const expiresIn = ttlOverrideMs === undefined ? TOKEN_TTL : Math.round(ttlOverrideMs / 1000);
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

/** The one response for every way a protected request can fail to
 * authenticate — bad signature, expired, missing claims, deleted user,
 * stale token_version, or an invalid/revoked/expired/foreign session. Never
 * reveals which of those it was. */
const AUTH_FAILURE = { error: "Invalid or expired token" } as const;

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    res.status(401).json(AUTH_FAILURE);
    return;
  }

  let payload: RegularUserTokenPayload;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as Partial<RegularUserTokenPayload>;
    // sub, tokenVersion, and sid are all required — in particular, a token
    // minted before the sid claim existed (i.e. before this migration) has
    // no session row backing it at all and must be rejected, not silently
    // defaulted the way a missing tokenVersion once was. Every existing
    // user needs to log in once after this deploys; see the README.
    if (!decoded.sub || typeof decoded.tokenVersion !== "number" || !decoded.sid) {
      res.status(401).json(AUTH_FAILURE);
      return;
    }
    payload = { sub: decoded.sub, tokenVersion: decoded.tokenVersion, sid: decoded.sid };
  } catch {
    res.status(401).json(AUTH_FAILURE);
    return;
  }

  try {
    const validation = await validateSession(payload.sid, payload.sub, payload.tokenVersion);
    if (!validation.valid) {
      res.status(401).json(AUTH_FAILURE);
      return;
    }
    req.userId = payload.sub;
    req.sessionId = payload.sid;
    if (validation.lastSeenAt) {
      await touchSessionIfStale(payload.sid, validation.lastSeenAt);
    }
  } catch (err) {
    next(err);
    return;
  }

  next();
}

// — Admin —
//
// Deliberately isolated from the regular user auth above: admin tokens carry a
// `role: "admin"` claim instead of a user id, are gated by a single shared
// ADMIN_PASSWORD (not any user's password), and expire much sooner. A compromised
// user account/token alone can't reach anything under requireAdmin.
const ADMIN_TOKEN_TTL = "12h";

export function signAdminToken(): string {
  return jwt.sign({ role: "admin" }, JWT_SECRET, { expiresIn: ADMIN_TOKEN_TTL });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { role?: string };
    if (payload.role !== "admin") {
      res.status(403).json({ error: "Admin access required" });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

/** Constant-time comparison against ADMIN_PASSWORD so response timing can't leak how much of a guess was correct. */
export function verifyAdminPassword(candidate: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(a, a); // burn roughly the same time as a real compare before failing
    return false;
  }
  return timingSafeEqual(a, b);
}
