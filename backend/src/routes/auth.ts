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
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
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
  // Optional so old clients (or a signup call that omits it) still work —
  // falls back to the same 18.50 default the app used before this was
  // exposed on the signup form, rather than rejecting the request.
  rate: z.coerce.number().min(0).max(1000).optional(),
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
    const { name, email, password, address, workLocationName, workAddress, multipleLocations, otherLocations, rate: rateInput, deviceInstallationId } =
      parsed.data;

    const existing = await db.execute({ sql: "SELECT id FROM users WHERE email = ?", args: [email] });
    if (existing.rows.length > 0) {
      res.status(409).json({ error: "An account with that email already exists" });
      return;
    }

    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    const rate = rateInput ?? 18.5;
    const goalHours = 35;
    const goalEarnings = Math.round(rate * goalHours * 100) / 100;

    await db.execute({
      sql: `INSERT INTO users (id, name, email, password_hash, address, work_location_name, work_address, multiple_locations, other_locations, week_starts_on, rate, goal_hours, goal_earnings, created_at)
            VALUES (@id, @name, @email, @passwordHash, @address, @workLocationName, @workAddress, @multipleLocations, @otherLocations, 'Monday', @rate, @goalHours, @goalEarnings, @createdAt)`,
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
        createdAt: new Date().toISOString(),
      },
    });

    const result = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [id] });
    const row = result.rows[0] as unknown as UserRow;

    const { userAgent, ipAddress } = extractClientInfo(req);
    const { sessionId } = await createSession({ userId: id, userAgent, ipAddress, deviceInstallationId });

    res.status(201).json({ token: signToken(id, row.token_version, sessionId), user: toPublicUser(row) });
  })
);

// Deliberately NOT run through validatePassword — that policy (15-128 chars,
// no common/blocklisted passwords) applies only to setting a new password
// (signup, change-password). Existing accounts created before this policy
// existed must still be able to log in with their original, shorter
// password, so login only checks that something was submitted.
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
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
    const { email, password, deviceInstallationId } = parsed.data;
    const result = await db.execute({ sql: "SELECT * FROM users WHERE email = ?", args: [email] });
    const row = result.rows[0] as unknown as UserRow | undefined;
    // Generic "incorrect email or password" for both a nonexistent email and a
    // wrong password — never reveals which one it was (OWASP account
    // enumeration guidance).
    if (!row || !(await verifyPassword(password, row.password_hash))) {
      res.status(401).json({ error: "Incorrect email or password" });
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
