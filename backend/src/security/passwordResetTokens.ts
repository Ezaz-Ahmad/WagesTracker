import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { applicationSecret } from "../config/secrets.js";
import { db } from "../db.js";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DIGEST_CONTEXT = "wage-tracker:recovery-credential:v1\0";

export function generateRecoveryCredential(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Store a deterministic keyed digest, never the bearer credential. HMAC is
 * intentionally fast here because the input is 256 bits of CSPRNG entropy,
 * not a human-chosen password; domain separation prevents reuse with JWTs.
 */
export function digestRecoveryCredential(rawCredential: string): string {
  return createHmac("sha256", applicationSecret())
    .update(DIGEST_CONTEXT, "utf8")
    .update(rawCredential, "utf8")
    .digest("hex");
}

export function isRecoveryCredential(rawCredential: unknown): rawCredential is string {
  return typeof rawCredential === "string" && TOKEN_PATTERN.test(rawCredential);
}

export async function issueRecoveryCredential(userId: string, ttlMs: number): Promise<string> {
  const rawCredential = generateRecoveryCredential();
  const tokenHash = digestRecoveryCredential(rawCredential);
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  const transaction = await db.transaction("write");

  try {
    // A fresh request supersedes every link still outstanding for this user.
    await transaction.execute({
      sql: `UPDATE password_reset_tokens SET invalidated_at = ?
            WHERE user_id = ? AND used_at IS NULL AND invalidated_at IS NULL`,
      args: [nowIso, userId],
    });
    await transaction.execute({
      sql: `INSERT INTO password_reset_tokens
              (id, user_id, token_hash, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?)`,
      args: [randomUUID(), userId, tokenHash, nowIso, expiresAt],
    });
    // Expired rows have no security value and would otherwise accumulate
    // forever on an account that requests many resets over its lifetime.
    await transaction.execute({ sql: "DELETE FROM password_reset_tokens WHERE expires_at < ?", args: [nowIso] });
    await transaction.commit();
    return rawCredential;
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  } finally {
    transaction.close();
  }
}

export async function invalidateRecoveryCredential(rawCredential: string): Promise<void> {
  if (!isRecoveryCredential(rawCredential)) return;
  await db.execute({
    sql: `UPDATE password_reset_tokens SET invalidated_at = ?
          WHERE token_hash = ? AND used_at IS NULL AND invalidated_at IS NULL`,
    args: [new Date().toISOString(), digestRecoveryCredential(rawCredential)],
  });
}
