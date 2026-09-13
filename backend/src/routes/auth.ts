import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { db } from "../db.js";
import { requireAuth, signToken, type AuthedRequest } from "../auth.js";
import { hashPassword, needsRehash, verifyPassword } from "../security/passwordHashing.js";
import { validatePassword } from "../security/passwordPolicy.js";
import { createSession, extractClientInfo, revokeSessionById } from "../security/sessions.js";
import { DEVICE_INSTALLATION_ID_MAX_LENGTH, MAX_ACTIVE_INSTALLATIONS, isValidDeviceInstallationId } from "../security/sessionPolicy.js";
import { toPublicUser, type UserRow } from "../types.js";
import { hasAtMostTwoDecimals } from "../fuelAllowances.js";
import { validateEmailAddress } from "../security/emailPolicy.js";
import {
  findUsableEmailVerificationCredential,
  issueEmailVerificationCredential,
} from "../security/emailVerificationTokens.js";
import {
  EMAIL_VERIFICATION_TTL_MS,
  isPasswordRecoveryConfigured,
  sendEmailChangedNotifications,
  sendEmailVerificationEmail,
  sendNotificationBestEffort,
} from "../email/emailService.js";

export const authRouter = Router();


/**
 * The client's per-installation identifier (see the frontend's
 * lib/deviceInstallation.ts). Optional so a client that doesn't send one
 * still logs in — it just gets an undeduplicated session, exactly as before.
 *
 * Rejected outright rather than trimmed or ignored when present but
 * malformed: this value is stored and used as a lookup key, and silently
 * accepting "whatever the client sent" is how a lookup key stops meaning
 * anything. It is not a secret and grants nothing on its own — every query
 * using it is scoped to the already-authenticated user.
 */
const deviceInstallationIdSchema = z
  .string()
  .max(DEVICE_INSTALLATION_ID_MAX_LENGTH, "Invalid device installation id")
  .refine(isValidDeviceInstallationId, "Invalid device installation id")
  .optional();

const signupSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string(),
  acceptEmailAsEntered: z.boolean().optional().default(false),
  // Deliberately not .trim()'d — see security/passwordPolicy.ts. The length/
  // blocklist rules themselves live in validatePassword, applied below via
  // superRefine, so the policy can never drift between signup and
  // change-password (both call the same function).
  password: z.string().superRefine((value, ctx) => {
    const result = validatePassword(value);
    if (!result.valid) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error ?? "Invalid password" });
    }
  }),
  address: z.string().trim().max(300).optional().default(""),
  workLocationName: z.string().trim().max(200).optional().default(""),
  workAddress: z.string().trim().max(300).optional().default(""),
  multipleLocations: z.boolean().optional().default(false),
  otherLocations: z.string().trim().max(300).optional().default(""),
  rate: z
    .number({ required_error: "Hourly rate is required", invalid_type_error: "Enter a valid hourly rate" })
    .positive("Hourly rate must be greater than zero")
    .max(1000, "Hourly rate cannot exceed 1000")
    .refine(hasAtMostTwoDecimals, "Hourly rate can have at most two decimal places"),
  deviceInstallationId: deviceInstallationIdSchema,
});

authRouter.post(
  "/signup",
  asyncHandler(async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { name, password, address, workLocationName, workAddress, multipleLocations, otherLocations, rate, deviceInstallationId } =
      parsed.data;
    const emailCheck = validateEmailAddress(parsed.data.email);
    if (!emailCheck.valid) {
      res.status(400).json({ error: emailCheck.error, code: "INVALID_EMAIL", field: "email" });
      return;
    }
    if (emailCheck.suggestion && !parsed.data.acceptEmailAsEntered) {
      res.status(400).json({
        error: `That email domain may be misspelled. Did you mean ${emailCheck.suggestion}?`,
        code: "EMAIL_DOMAIN_TYPO",
        field: "email",
        suggestion: emailCheck.suggestion,
      });
      return;
    }
    const email = emailCheck.normalized;

    const existing = await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [email] });
    if (existing.rows.length > 0) {
      res.status(409).json({
        error: "An account with that email already exists. Log in or request a verification link if signup is unfinished.",
        code: "EMAIL_ALREADY_EXISTS",
        field: "email",
      });
      return;
    }

    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    const goalHours = 35;
    const goalEarnings = Math.round(rate * goalHours * 100) / 100;

    const configuredLocations = new Map<string, { name: string; address: string }>();
    const addLocation = (rawName: string, locationAddress = "") => {
      const locationName = rawName.trim().replace(/\s+/g, " ");
      const normalizedName = locationName.toLocaleLowerCase("en-AU");
      if (normalizedName && !configuredLocations.has(normalizedName)) {
        configuredLocations.set(normalizedName, { name: locationName, address: locationAddress });
      }
    };
    addLocation(workLocationName, workAddress);
    for (const locationName of otherLocations.split(/[,;\n]+/)) addLocation(locationName);
    const createdAt = new Date().toISOString();
    const transaction = await db.transaction("write");
    try {
      const verificationRequired = process.env.NODE_ENV !== "test" || process.env.EMAIL_VERIFICATION_REQUIRED === "true";
      await transaction.execute({
        sql: `INSERT INTO users (id, name, email, password_hash, address, work_location_name, work_address, multiple_locations, other_locations, week_starts_on, rate, goal_hours, goal_earnings, email_verified, created_at)
              VALUES (@id, @name, @email, @passwordHash, @address, @workLocationName, @workAddress, @multipleLocations, @otherLocations, 'Monday', @rate, @goalHours, @goalEarnings, @emailVerified, @createdAt)`,
        args: {
          id,
          name,
          email,
          passwordHash,
          address,
          workLocationName,
          workAddress,
          multipleLocations: multipleLocations ? 1 : 0,
          otherLocations,
          rate,
          goalHours,
          goalEarnings,
          emailVerified: verificationRequired ? 0 : 1,
          createdAt,
        },
      });
      for (const [normalizedName, location] of configuredLocations) {
        await transaction.execute({
          sql: `INSERT INTO work_locations
                (id, user_id, name, normalized_name, address, fuel_allowance_cents, archived_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
          args: [randomUUID(), id, location.name, normalizedName, location.address, createdAt, createdAt],
        });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      if (String(error).toLowerCase().includes("unique")) {
        res.status(409).json({ error: "An account with that email already exists", code: "EMAIL_ALREADY_EXISTS", field: "email" });
        return;
      }
      throw error;
    } finally {
      transaction.close();
    }

    const result = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
    const row = result.rows[0] as unknown as UserRow;

    const verificationRequired = process.env.NODE_ENV !== "test" || process.env.EMAIL_VERIFICATION_REQUIRED === "true";
    if (verificationRequired) {
      if (!isPasswordRecoveryConfigured()) {
        await db.batch([
          { sql: "DELETE FROM work_locations WHERE user_id = ?", args: [id] },
          { sql: "DELETE FROM users WHERE id = ? AND email_verified = 0", args: [id] },
        ], "write");
        res.status(503).json({
          error: "Email verification is temporarily unavailable. Your account was not created; please try again later.",
          code: "EMAIL_DELIVERY_UNAVAILABLE",
        });
        return;
      }
      try {
        const rawToken = await issueEmailVerificationCredential({
          userId: id,
          purpose: "signup",
          targetEmail: email,
          ttlMs: EMAIL_VERIFICATION_TTL_MS,
        });
        await sendEmailVerificationEmail({ to: email, name, rawToken, purpose: "signup" });
      } catch {
        await db.batch([
          { sql: "DELETE FROM email_verification_tokens WHERE user_id = ?", args: [id] },
          { sql: "DELETE FROM work_locations WHERE user_id = ?", args: [id] },
          { sql: "DELETE FROM users WHERE id = ? AND email_verified = 0", args: [id] },
        ], "write");
        res.status(503).json({
          error: "We couldn't send the verification email, so no account was created. Check the address and try again.",
          code: "EMAIL_DELIVERY_FAILED",
          field: "email",
        });
        return;
      }
      res.status(202).json({
        verificationRequired: true,
        email,
        message: "Check your inbox and verify your email before logging in. The link expires in 24 hours.",
      });
      return;
    }

    const { userAgent, ipAddress } = extractClientInfo(req);
    const { sessionId } = await createSession({ userId: id, userAgent, ipAddress, deviceInstallationId });

    res.status(201).json({ token: signToken(id, row.token_version, sessionId), user: toPublicUser(row) });
  })
);

// Deliberately NOT run through validatePassword — that policy (10-128 chars,
// no common/blocklisted passwords) applies only to setting a new password
// (signup, change-password). Existing accounts created before this policy
// existed must still be able to log in with their original, shorter
// password, so login only checks that something was submitted.
const loginSchema = z.object({
  email: z.string(),
  password: z.string().min(1, "Password is required"),
  deviceInstallationId: deviceInstallationIdSchema,
});

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const emailCheck = validateEmailAddress(parsed.data.email);
    if (!emailCheck.valid) {
      res.status(400).json({ error: emailCheck.error, code: "INVALID_EMAIL", field: "email" });
      return;
    }
    const { password, deviceInstallationId } = parsed.data;
    const email = emailCheck.normalized;
    const result = await db.execute({ sql: "SELECT * FROM users WHERE email = ?", args: [email] });
    const row = result.rows[0] as unknown as UserRow | undefined;
    // Generic "incorrect email or password" for both a nonexistent email and a
    // wrong password — never reveals which one it was (OWASP account
    // enumeration guidance).
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      res.status(401).json({ error: "Incorrect email or password" });
      return;
    }
    if (!row.email_verified) {
      res.status(403).json({
        error: "Verify your email before logging in. Use the link in your inbox or request a new one.",
        code: "EMAIL_NOT_VERIFIED",
        field: "email",
      });
      return;
    }

    // Transparent migration off legacy bcrypt: a successful login is the one
    // moment this request already holds the plaintext password, so it's the
    // only place this upgrade can happen without a forced reset. Awaited
    // before responding so the stored hash and the token issued below are
    // never observably out of sync with each other.
    if (needsRehash(row.password_hash)) {
      row.password_hash = await hashPassword(password);
      await db.execute({
        sql: "UPDATE users SET password_hash = ? WHERE id = ?",
        args: [row.password_hash, row.id],
      });
    }

    const { userAgent, ipAddress } = extractClientInfo(req);
    // Signing in from an installation that already has a session rotates it:
    // the old session is revoked as the new one is created, in one
    // transaction, so this device shows up once in Settings rather than once
    // per login. See createSession in ../security/sessions.ts.
    const { sessionId, evictedForLimit } = await createSession({
      userId: row.id,
      userAgent,
      ipAddress,
      deviceInstallationId,
    });

    res.json({
      token: signToken(row.id, row.token_version, sessionId),
      user: toPublicUser(row),
      // Told, not hidden: hitting the device limit signs out the device that
      // has gone longest without being used, and the user deserves to know
      // that happened rather than discovering it later.
      ...(evictedForLimit > 0
        ? {
            notice: `You were signed in on more than ${MAX_ACTIVE_INSTALLATIONS} devices, so the ${
              evictedForLimit === 1 ? "least recently used one was" : `${evictedForLimit} least recently used were`
            } signed out.`,
          }
        : {}),
    });
  })
);

const resendVerificationSchema = z.object({ email: z.string() });

authRouter.post(
  "/resend-verification",
  asyncHandler(async (req, res) => {
    const parsed = resendVerificationSchema.safeParse(req.body);
    const emailCheck = parsed.success ? validateEmailAddress(parsed.data.email) : null;
    if (!emailCheck?.valid) {
      res.status(400).json({ error: emailCheck?.error ?? "Email is required", code: "INVALID_EMAIL", field: "email" });
      return;
    }
    if (!isPasswordRecoveryConfigured()) {
      res.status(503).json({ error: "Email verification is temporarily unavailable. Please try again later." });
      return;
    }

    const result = await db.execute({
      sql: "SELECT id, name, email FROM users WHERE email = ? AND email_verified = 0",
      args: [emailCheck.normalized],
    });
    const row = result.rows[0] as unknown as { id: string; name: string; email: string } | undefined;
    if (row) {
      try {
        const rawToken = await issueEmailVerificationCredential({
          userId: row.id,
          purpose: "signup",
          targetEmail: row.email,
          ttlMs: EMAIL_VERIFICATION_TTL_MS,
        });
        await sendEmailVerificationEmail({ to: row.email, name: row.name, rawToken, purpose: "signup" });
      } catch {
        res.status(503).json({ error: "We couldn't send the verification email. Please try again in a moment." });
        return;
      }
    }
    res.status(202).json({
      message: "If that address has an unverified account, a new verification link is on its way.",
    });
  })
);

const verifyEmailSchema = z.object({ token: z.string() });

authRouter.post(
  "/verify-email",
  asyncHandler(async (req, res) => {
    const parsed = verifyEmailSchema.safeParse(req.body);
    const credential = parsed.success ? await findUsableEmailVerificationCredential(parsed.data.token) : null;
    if (!credential) {
      res.status(400).json({
        error: "This email verification link is invalid or has expired. Request a new one and try again.",
        code: "INVALID_EMAIL_VERIFICATION_TOKEN",
      });
      return;
    }

    const userResult = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [credential.user_id] });
    const user = userResult.rows[0] as unknown as UserRow | undefined;
    if (!user) {
      res.status(400).json({ error: "This email verification link is no longer valid.", code: "INVALID_EMAIL_VERIFICATION_TOKEN" });
      return;
    }

    const nowIso = new Date().toISOString();
    const oldEmail = user.email;
    const transaction = await db.transaction("write");
    try {
      // Claim the credential first, inside the same write transaction as the
      // account update. Two simultaneous clicks cannot both consume it.
      const claimed = await transaction.execute({
        sql: `UPDATE email_verification_tokens SET used_at = ?
              WHERE id = ? AND used_at IS NULL AND invalidated_at IS NULL AND expires_at > ?`,
        args: [nowIso, credential.id, nowIso],
      });
      if (claimed.rowsAffected !== 1) {
        await transaction.rollback();
        res.status(400).json({ error: "This email verification link is no longer valid.", code: "INVALID_EMAIL_VERIFICATION_TOKEN" });
        return;
      }

      if (credential.purpose === "signup") {
        const updated = await transaction.execute({
          sql: "UPDATE users SET email_verified = 1 WHERE id = ? AND email = ?",
          args: [user.id, credential.target_email],
        });
        if (updated.rowsAffected !== 1) {
          await transaction.rollback();
          res.status(400).json({ error: "This email verification link is no longer valid.", code: "INVALID_EMAIL_VERIFICATION_TOKEN" });
          return;
        }
      } else {
        if (!credential.previous_email || user.email !== credential.previous_email) {
          await transaction.rollback();
          res.status(400).json({ error: "A newer email change has replaced this request.", code: "INVALID_EMAIL_VERIFICATION_TOKEN" });
          return;
        }
        const duplicate = await transaction.execute({
          sql: "SELECT id FROM users WHERE email = ? AND id != ?",
          args: [credential.target_email, user.id],
        });
        if (duplicate.rows.length > 0) {
          await transaction.rollback();
          res.status(409).json({ error: "That email is already used by another account.", code: "EMAIL_ALREADY_EXISTS", field: "email" });
          return;
        }
        const updated = await transaction.execute({
          sql: "UPDATE users SET email = ?, email_verified = 1 WHERE id = ? AND email = ?",
          args: [credential.target_email, user.id, credential.previous_email],
        });
        if (updated.rowsAffected !== 1) {
          await transaction.rollback();
          res.status(400).json({ error: "A newer email change has replaced this request.", code: "INVALID_EMAIL_VERIFICATION_TOKEN" });
          return;
        }
        await transaction.execute({
          sql: `UPDATE email_verification_tokens SET invalidated_at = ?
                WHERE user_id = ? AND id != ? AND used_at IS NULL AND invalidated_at IS NULL`,
          args: [nowIso, user.id, credential.id],
        });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback().catch(() => undefined);
      if (String(error).toLowerCase().includes("unique")) {
        res.status(409).json({ error: "That email is already used by another account.", code: "EMAIL_ALREADY_EXISTS", field: "email" });
        return;
      }
      throw error;
    } finally {
      transaction.close();
    }

    if (credential.purpose === "change") {
      sendNotificationBestEffort("email-change", () => sendEmailChangedNotifications({
        oldEmail,
        newEmail: credential.target_email,
        name: user.name,
      }));
    }

    res.json({
      verified: true,
      purpose: credential.purpose,
      email: credential.target_email,
      message: credential.purpose === "signup"
        ? "Email verified. You can now log in with the password you chose."
        : "Your email has been updated. Use the new address next time you log in; your password is unchanged.",
    });
  })
);

/**
 * Server-side logout: revokes the session backing the request's own JWT, so
 * it stops working immediately rather than just being discarded client-side
 * (which a stolen/copied token wouldn't be affected by at all). Requires
 * auth specifically to learn *which* session to revoke — req.sessionId
 * comes only from requireAuth's own validation of the caller's token, never
 * from anything the client sends directly (see AuthedRequest in ../auth.ts).
 */
authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler<AuthedRequest>(async (req, res) => {
    await revokeSessionById(req.sessionId!);
    res.status(204).end();
  })
);
