import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { timingSafeEqual } from "node:crypto";

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

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { sub: string };
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
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
