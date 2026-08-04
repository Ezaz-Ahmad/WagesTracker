import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

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
