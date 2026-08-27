import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "../db.js";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generatePasswordResetToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashPasswordResetToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function isPasswordResetToken(rawToken: unknown): rawToken is string {
  return typeof rawToken === "string" && TOKEN_PATTERN.test(rawToken);
}

export async function issuePasswordResetToken(userId: string, ttlMs: number): Promise<string> {
  const rawToken = generatePasswordResetToken();
  const tokenHash = hashPasswordResetToken(rawToken);
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
    return rawToken;
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  } finally {
    transaction.close();
  }
}

export async function invalidatePasswordResetToken(rawToken: string): Promise<void> {
  if (!isPasswordResetToken(rawToken)) return;
  await db.execute({
    sql: `UPDATE password_reset_tokens SET invalidated_at = ?
          WHERE token_hash = ? AND used_at IS NULL AND invalidated_at IS NULL`,
    args: [new Date().toISOString(), hashPasswordResetToken(rawToken)],
  });
}
