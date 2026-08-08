import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { timingSafeEqual } from "node:crypto";
import { db } from "./db.js";

const DEV_FALLBACK_SECRET = "dev-secret-change-me";

if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET === DEV_FALLBACK_SECRET)) {
  throw new Error(
    "JWT_SECRET must be set to a strong, unique value in production. Refusing to start with the default/dev secret."
  );
}

const JWT_SECRET = process.env.JWT_SECRET || DEV_FALLBACK_SECRET;
const TOKEN_TTL = "30d";

export interface AuthedRequest extends Request {
  userId?: string;
}

interface RegularUserTokenPayload {
  sub: string;
  tokenVersion: number;
}

/**
 * Regular-user JWTs carry a `tokenVersion` claim mirroring `users.token_version`
 * at the moment they were issued. A password change increments the stored
 * column, which instantly invalidates every token minted before it — see
 * requireAuth below, which checks the two against each other on every
 * request. This is the only way to actually revoke a stateless JWT before its
 * natural 30-day expiry.
 */
export function signToken(userId: string, tokenVersion: number): string {
  const payload: RegularUserTokenPayload = { sub: userId, tokenVersion };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  let payload: RegularUserTokenPayload;
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as Partial<RegularUserTokenPayload>;
    if (!decoded.sub) throw new Error("missing sub");
    // Tokens minted before tokenVersion existed (pre-migration) carry no
    // claim at all — treated as version 0, matching the column's own default
    // for every pre-existing account, so those sessions keep working.
    payload = { sub: decoded.sub, tokenVersion: decoded.tokenVersion ?? 0 };
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  try {
    const result = await db.execute({ sql: "SELECT token_version FROM users WHERE id = ?", args: [payload.sub] });
    const row = result.rows[0] as unknown as { token_version: number } | undefined;
    if (!row || Number(row.token_version) !== payload.tokenVersion) {
      // Either the account no longer exists, or the password has changed
      // since this token was issued — same response either way so nothing
      // about the account is revealed.
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
  } catch (err) {
    next(err);
    return;
  }

  req.userId = payload.sub;
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
