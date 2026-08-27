import { createHash } from "node:crypto";
import type { Request } from "express";
import rateLimit, { type RateLimitRequestHandler } from "express-rate-limit";

export const PASSWORD_RECOVERY_RATE_LIMITS = {
  forgotPasswordPerIp: { windowMs: 15 * 60 * 1000, limit: 5, env: "RATE_LIMIT_FORGOT_PASSWORD_IP" },
  forgotPasswordPerEmail: { windowMs: 60 * 60 * 1000, limit: 3, env: "RATE_LIMIT_FORGOT_PASSWORD_EMAIL" },
  resetPassword: { windowMs: 15 * 60 * 1000, limit: 15, env: "RATE_LIMIT_RESET_PASSWORD" },
} as const;

type LimitName = keyof typeof PASSWORD_RECOVERY_RATE_LIMITS;

function resolvedLimit(name: LimitName): { windowMs: number; limit: number } {
  const policy = PASSWORD_RECOVERY_RATE_LIMITS[name];
  const override = Number(process.env[policy.env]);
  return {
    windowMs: policy.windowMs,
    limit: Number.isInteger(override) && override > 0 ? override : policy.limit,
  };
}

const TOO_MANY = { error: "Too many attempts. Please try again later." } as const;

export function recoveryIpLimiter(name: LimitName): RateLimitRequestHandler {
  const { windowMs, limit } = resolvedLimit(name);
  return rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: TOO_MANY });
}

function normalizedEmail(req: Request): string | null {
  const rawEmail = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof rawEmail !== "string") return null;
  const email = rawEmail.trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes("@")) return null;
  return email;
}

export function recoveryEmailLimiter(name: LimitName): RateLimitRequestHandler {
  const { windowMs, limit } = resolvedLimit(name);
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: TOO_MANY,
    skip: (req) => normalizedEmail(req) === null,
    // The rate-limit store contains no plaintext account addresses.
    keyGenerator: (req) => `email:${createHash("sha256").update(normalizedEmail(req) ?? "").digest("hex")}`,
  });
}
