import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { applicationSecret } from "../config/secrets.js";
import { db } from "../db.js";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const DIGEST_CONTEXT = "wage-tracker:email-verification:v1\0";

export type EmailVerificationPurpose = "signup" | "change";

export interface EmailVerificationRow {
  id: string;
  user_id: string;
  token_hash: string;
  purpose: EmailVerificationPurpose;
  target_email: string;
  previous_email: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  invalidated_at: string | null;
}
export function generateEmailVerificationCredential(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function digestEmailVerificationCredential(rawCredential: string): string {
  return createHmac("sha256", applicationSecret())
    .update(DIGEST_CONTEXT, "utf8")
    .update(rawCredential, "utf8")
    .digest("hex");
}

export function isEmailVerificationCredential(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

export async function issueEmailVerificationCredential(input: {
  userId: string;
  purpose: EmailVerificationPurpose;
  targetEmail: string;
  previousEmail?: string | null;
  ttlMs: number;
}): Promise<string> {
  const rawCredential = generateEmailVerificationCredential();
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
  const transaction = await db.transaction("write");
  try {
    await transaction.execute({
      sql: `UPDATE email_verification_tokens SET invalidated_at = ?
            WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND invalidated_at IS NULL`,
      args: [nowIso, input.userId, input.purpose],
    });
    await transaction.execute({
      sql: `INSERT INTO email_verification_tokens
              (id, user_id, token_hash, purpose, target_email, previous_email, created_at, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        randomUUID(),
        input.userId,
        digestEmailVerificationCredential(rawCredential),
        input.purpose,
        input.targetEmail,
        input.previousEmail ?? null,
        nowIso,
        expiresAt,
      ],
    });
    await transaction.execute({ sql: "DELETE FROM email_verification_tokens WHERE expires_at < ?", args: [nowIso] });
    await transaction.commit();
    return rawCredential;
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  } finally {
    transaction.close();
  }
}

export async function findUsableEmailVerificationCredential(rawCredential: unknown): Promise<EmailVerificationRow | null> {
  if (!isEmailVerificationCredential(rawCredential)) return null;
  const result = await db.execute({
    sql: `SELECT * FROM email_verification_tokens
          WHERE token_hash = ? AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > ?
          LIMIT 1`,
    args: [digestEmailVerificationCredential(rawCredential), new Date().toISOString()],
  });
  return (result.rows[0] as unknown as EmailVerificationRow | undefined) ?? null;
}
