import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { db } from "../db.js";
import {
  isPasswordRecoveryConfigured,
  PASSWORD_RESET_TTL_MS,
  sendNotificationBestEffort,
  sendPasswordChangedEmail,
  sendPasswordResetEmail,
} from "../email/emailService.js";
import { hashPassword, verifyPassword } from "../security/passwordHashing.js";
import { validatePassword } from "../security/passwordPolicy.js";
import {
  digestRecoveryCredential,
  invalidateRecoveryCredential,
  isRecoveryCredential,
  issueRecoveryCredential,
} from "../security/passwordResetTokens.js";
import type { UserRow } from "../types.js";

export const passwordResetRouter = Router();

const NEUTRAL_RESET_RESPONSE = {
  message: "If an account exists for this email, we've sent password reset instructions.",
} as const;

const INVALID_RESET_TOKEN = {
  error: "This password reset link is no longer valid. Request a new one and try again.",
  code: "INVALID_RESET_TOKEN",
} as const;

const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email() });

/**
 * Mail work is intentionally detached from the HTTP response. Known and
 * unknown addresses therefore receive the same status/body without a mail
 * provider round trip becoming a timing oracle. The app is a persistent
 * Render service, so this in-process queue continues after the response.
 * Requests for one address are serialized: an older slow email can never
 * arrive after a newer email whose token already superseded it.
 */
const emailQueues = new Map<string, Promise<void>>();

async function processPasswordResetRequest(email: string): Promise<void> {
  const result = await db.execute({ sql: "SELECT * FROM users WHERE email = ?", args: [email] });
  const user = result.rows[0] as unknown as UserRow | undefined;
  if (!user) return;

  const recoveryCredential = await issueRecoveryCredential(user.id, PASSWORD_RESET_TTL_MS);
  try {
    await sendPasswordResetEmail({ to: user.email, name: user.name, rawToken: recoveryCredential });
  } catch (error) {
    // Never leave a usable link behind when its delivery failed.
    await invalidateRecoveryCredential(recoveryCredential).catch(() => undefined);
    throw error;
  }
}

function queuePasswordResetRequest(email: string): void {
  const queueKey = createHash("sha256").update(email).digest("hex");
  const previous = emailQueues.get(queueKey) ?? Promise.resolve();
  const task = previous
    .catch(() => undefined)
    .then(() => processPasswordResetRequest(email))
    .catch(() => {
      // The caller already received the deliberately-neutral response. Log
      // only an operation label—never an address, token, URL, or provider
      // body that could contain any of them.
      console.error("[email] password-reset email could not be delivered.");
    });
  emailQueues.set(queueKey, task);
  void task.then(() => {
    if (emailQueues.get(queueKey) === task) emailQueues.delete(queueKey);
  });
}

/** Allows automated tests and graceful shutdown code to wait until already
 * accepted reset-mail jobs have settled. */
export async function waitForPendingPasswordResetEmails(): Promise<void> {
  while (emailQueues.size > 0) await Promise.all([...emailQueues.values()]);
}

passwordResetRouter.post(
  "/forgot-password",
  asyncHandler(async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    // Invalid input is still neutral. It neither confirms nor denies that
    // any nearby spelling belongs to an account.
    if (!parsed.success) {
      res.json(NEUTRAL_RESET_RESPONSE);
      return;
    }

    // Configuration failures do not depend on account existence and are
    // therefore safe to report. Returning 503 avoids pretending an email
    // was accepted when the server has no way to produce a valid link.
    if (!isPasswordRecoveryConfigured()) {
      res.status(503).json({
        error: "Password reset is temporarily unavailable. Please try again shortly.",
        code: "EMAIL_UNAVAILABLE",
      });
      return;
    }

    queuePasswordResetRequest(parsed.data.email);
    res.json(NEUTRAL_RESET_RESPONSE);
  })
);

const passwordSchema = z.string().superRefine((password, context) => {
  const result = validatePassword(password);
  if (!result.valid) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: result.error ?? "Invalid password" });
  }
});

const resetPasswordSchema = z.object({ token: z.string(), password: passwordSchema });
const validateTokenSchema = z.object({ token: z.string() });

passwordResetRouter.post(
  "/reset-password/validate",
  asyncHandler(async (req, res) => {
    const parsed = validateTokenSchema.safeParse(req.body);
    if (!parsed.success || !isRecoveryCredential(parsed.data.token)) {
      res.status(400).json(INVALID_RESET_TOKEN);
      return;
    }

    const result = await db.execute({
      sql: `SELECT 1 FROM password_reset_tokens
            WHERE token_hash = ? AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > ?`,
      args: [digestRecoveryCredential(parsed.data.token), new Date().toISOString()],
    });
    if (result.rows.length === 0) {
      res.status(400).json(INVALID_RESET_TOKEN);
      return;
    }
    res.json({ valid: true });
  })
);

passwordResetRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }

    const { token, password } = parsed.data;
    if (!isRecoveryCredential(token)) {
      res.status(400).json(INVALID_RESET_TOKEN);
      return;
    }

    const tokenHash = digestRecoveryCredential(token);
    const lookupNowIso = new Date().toISOString();
    const liveToken = await db.execute({
      sql: `SELECT u.* FROM password_reset_tokens t
            JOIN users u ON u.id = t.user_id
            WHERE t.token_hash = ? AND t.used_at IS NULL AND t.invalidated_at IS NULL AND t.expires_at > ?`,
      args: [tokenHash, lookupNowIso],
    });
    const userBeforeReset = liveToken.rows[0] as unknown as UserRow | undefined;
    if (!userBeforeReset) {
      res.status(400).json(INVALID_RESET_TOKEN);
      return;
    }

    // Match authenticated change-password behaviour and leave the link
    // usable so the person can choose a genuinely new password.
    if (await verifyPassword(password, userBeforeReset.password_hash)) {
      res.status(400).json({ error: "New password must be different from your current password" });
      return;
    }

    // The expensive Argon2 work happens before the token is consumed. A
    // resource failure cannot burn a link without changing the password.
    const newPasswordHash = await hashPassword(password);
    const transaction = await db.transaction("write");
    let user: UserRow | undefined;

    try {
      // Re-read the clock after Argon2 work so a link that expires while the
      // password is being hashed cannot slip through on the earlier time.
      const transactionNowIso = new Date().toISOString();
      const consumed = await transaction.execute({
        sql: `UPDATE password_reset_tokens SET used_at = ?
              WHERE token_hash = ? AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > ?`,
        args: [transactionNowIso, tokenHash, transactionNowIso],
      });
      if (Number(consumed.rowsAffected) !== 1) {
        await transaction.rollback();
        res.status(400).json(INVALID_RESET_TOKEN);
        return;
      }

      const userResult = await transaction.execute({
        sql: `SELECT u.* FROM users u
              JOIN password_reset_tokens t ON t.user_id = u.id
              WHERE t.token_hash = ?`,
        args: [tokenHash],
      });
      user = userResult.rows[0] as unknown as UserRow | undefined;
      if (!user) {
        await transaction.rollback();
        res.status(400).json(INVALID_RESET_TOKEN);
        return;
      }

      await transaction.execute({
        sql: "UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE id = ?",
        args: [newPasswordHash, user.id],
      });
      await transaction.execute({
        sql: "UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
        args: [transactionNowIso, user.id],
      });
      await transaction.execute({
        sql: `UPDATE password_reset_tokens SET invalidated_at = ?
              WHERE user_id = ? AND token_hash != ? AND used_at IS NULL AND invalidated_at IS NULL`,
        args: [transactionNowIso, user.id, tokenHash],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      throw error;
    } finally {
      transaction.close();
    }

    sendNotificationBestEffort("password-changed", () =>
      sendPasswordChangedEmail({ to: user!.email, name: user!.name })
    );

    res.json({ message: "Your password has been reset. You can now log in with your new password." });
  })
);
