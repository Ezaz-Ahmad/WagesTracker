import type { InValue } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { db } from "../db.js";
import { requireAuth, signToken, type AuthedRequest } from "../auth.js";
import { hashPassword, verifyPassword } from "../security/passwordHashing.js";
import { validatePassword } from "../security/passwordPolicy.js";
import {
  extractClientInfo,
  listSessionsForUser,
  revokeOtherSessions,
  revokeSessionById,
  rotateSessionForBiometricProtection,
  sessionBelongsToUser,
  SESSION_TTL_MS,
} from "../security/sessions.js";
import { toPublicSession, toPublicUser, toPublicWeekExtra, type UserRow, type WeekExtraRow } from "../types.js";
import { WEEK_DAYS, addIsoDays, startOfWeekISO, type WeekStart } from "../weekBoundary.js";
import { hasAtMostTwoDecimals } from "../fuelAllowances.js";

export const meRouter = Router();
meRouter.use(requireAuth);

meRouter.get(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const result = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.userId!] });
    const row = result.rows[0] as unknown as UserRow | undefined;
    if (!row) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json({ user: toPublicUser(row) });
  })
);

/**
 * Lists the authenticated user's own currently-valid sessions (never
 * revoked/expired ones, and never another user's) — the "Security &
 * Sessions" list in Settings. `isCurrent` is computed from req.sessionId,
 * which requireAuth attached from the caller's own validated JWT; the
 * frontend has no way to tell the backend which session is "current"
 * itself (see AuthedRequest in ../auth.ts).
 */
meRouter.get(
  "/sessions",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const sessions = await listSessionsForUser(req.userId!);
    // Current device first, then everything else newest-active first (the
    // query already returns that order). Sorted here rather than in SQL
    // because "current" isn't a property of the row — it's whichever session
    // this particular request authenticated with.
    const publicSessions = sessions
      .map((s) => toPublicSession(s, req.sessionId!))
      .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent));
    res.json({ sessions: publicSessions });
  })
);

// Registered before "/sessions/:sessionId" below — Express matches routes in
// registration order, so this static path has to come first or "others"
// would be swallowed as a :sessionId value instead of hitting this handler.
meRouter.delete(
  "/sessions/others",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await revokeOtherSessions(req.userId!, req.sessionId!);
    res.status(204).end();
  })
);

meRouter.delete(
  "/sessions/:sessionId",
  asyncHandler<AuthedRequest>(async (req, res) => {
    // Same 404 for "doesn't exist" and "belongs to someone else" — a user
    // must never be able to distinguish another user's session id from one
    // that was never issued at all.
    const owns = await sessionBelongsToUser(req.params.sessionId, req.userId!);
    if (!owns) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    await revokeSessionById(req.params.sessionId);
    // Not a bare 204: the frontend needs to know whether it just revoked its
    // own current session so it can log itself out immediately, rather than
    // waiting for some future request to fail with a generic 401.
    res.json({ revokedCurrent: req.params.sessionId === req.sessionId });
  })
);

const sessionBiometricProtectionSchema = z.object({ biometricProtected: z.boolean() });

/**
 * Marks (or unmarks) the calling request's own session as biometric-
 * protected — see validateSession's idle-timeout exemption in
 * security/sessions.ts. Called by the frontend right after Face ID/Touch ID
 * is turned on (with `true`) or off (with `false`); there is deliberately no
 * way to target any session other than "the one this request authenticated
 * with" — `req.sessionId` only, never a body/param id — since biometric
 * protection is inherently a property of "the credential this specific
 * device is holding", not something one session can set for another.
 *
 * Marking a session protected also moves it onto the much longer
 * BIOMETRIC_SESSION_TTL_MS absolute lifetime (5 years, vs. the ordinary
 * 30 days) — see rotateSessionForBiometricProtection's own comment for why
 * that can't be done by mutating this row in place. Like changePassword
 * below, this responds `204 No Content` with the replacement token in the
 * `X-New-Token` header rather than a JSON body, since the caller's current
 * token is revoked as part of the same rotation and would otherwise stop
 * working the instant this request completes.
 */
meRouter.patch(
  "/sessions/current",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = sessionBiometricProtectionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "biometricProtected must be a boolean" });
      return;
    }
    const rotated = await rotateSessionForBiometricProtection(
      req.sessionId!,
      req.userId!,
      parsed.data.biometricProtected
    );
    if (!rotated) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    const replacementToken = signToken(req.userId!, rotated.tokenVersion, rotated.sessionId, rotated.ttlMs);
    res.setHeader("X-New-Token", replacementToken);
    res.status(204).end();
  })
);

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  address: z.string().trim().max(300).optional(),
  workLocationName: z.string().trim().max(200).optional(),
  workAddress: z.string().trim().max(300).optional(),
  multipleLocations: z.boolean().optional(),
  otherLocations: z.string().trim().max(300).optional(),
  weekStartsOn: z.enum(WEEK_DAYS).optional(),
  rate: z
    .number()
    .positive("Hourly rate must be greater than zero")
    .max(1000, "Hourly rate cannot exceed 1000")
    .refine(hasAtMostTwoDecimals, "Hourly rate can have at most two decimal places")
    .optional(),
  goalHours: z.number().min(0).max(200).optional(),
  goalEarnings: z.number().min(0).max(100000).optional(),
});

const FIELD_TO_COLUMN: Record<string, string> = {
  name: "name",
  address: "address",
  workLocationName: "work_location_name",
  workAddress: "work_address",
  multipleLocations: "multiple_locations",
  otherLocations: "other_locations",
  weekStartsOn: "week_starts_on",
  rate: "rate",
  goalHours: "goal_hours",
  goalEarnings: "goal_earnings",
};

meRouter.patch(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const updates = parsed.data;
    const keys = Object.keys(updates) as (keyof typeof updates)[];
    if (keys.length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const setClauses: string[] = [];
    const params: Record<string, InValue> = { id: req.userId! };
    for (const key of keys) {
      const column = FIELD_TO_COLUMN[key];
      let value: InValue = updates[key] as InValue;
      if (key === "multipleLocations") value = value ? 1 : 0;
      setClauses.push(`${column} = @${key}`);
      params[key] = value;
    }

    // A week-start change and every weekly-extra reassociation are one write
    // transaction. The raw dated shifts/expenses/spending rows are never
    // touched. Only each extra's derived lookup key changes; its stable
    // effective_date, amount, reason, and audit timestamps remain intact.
    const transaction = await db.transaction("write");
    let row: UserRow;
    let reassociatedExtras: ReturnType<typeof toPublicWeekExtra>[] | undefined;
    try {
      const currentResult = await transaction.execute({
        sql: "SELECT week_starts_on FROM users WHERE id = ?",
        args: [req.userId!],
      });
      const current = currentResult.rows[0] as unknown as { week_starts_on: WeekStart } | undefined;
      if (!current) {
        await transaction.rollback();
        res.status(404).json({ error: "User not found" });
        return;
      }

      const nextWeekStart = updates.weekStartsOn;
      if (nextWeekStart && nextWeekStart !== current.week_starts_on) {
        const extrasResult = await transaction.execute({
          sql: "SELECT id, week_start, effective_date FROM week_extras WHERE user_id = ? ORDER BY week_start",
          args: [req.userId!],
        });
        const reassociations: Array<{ id: string; effectiveDate: string; weekStart: string }> = [];
        const targetDates = new Set<string>();

        try {
          for (const raw of extrasResult.rows) {
            const extra = raw as unknown as { id: string; week_start: string; effective_date: string | null };
            const effectiveDate = extra.effective_date || addIsoDays(extra.week_start, 6);
            const weekStart = startOfWeekISO(effectiveDate, nextWeekStart);
            if (targetDates.has(weekStart)) {
              await transaction.rollback();
              res.status(409).json({
                error: "Two saved weekly extras would overlap under that week start. No settings or records were changed.",
              });
              return;
            }
            targetDates.add(weekStart);
            reassociations.push({ id: extra.id, effectiveDate, weekStart });
          }
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          await transaction.rollback();
          res.status(409).json({
            error: "A saved weekly extra has an invalid historical date. No settings or records were changed.",
          });
          return;
        }

        if (reassociations.length > 0) {
          // Move keys out of the date namespace first. This prevents a
          // temporary UNIQUE(user_id, week_start) collision even if an old
          // client once saved a non-aligned date. Nothing outside this
          // transaction can observe the temporary values.
          await transaction.execute({
            sql: "UPDATE week_extras SET week_start = '__reassociate__' || id WHERE user_id = ?",
            args: [req.userId!],
          });
          await transaction.batch(
            reassociations.map((extra) => ({
              sql: "UPDATE week_extras SET week_start = ?, effective_date = ? WHERE id = ? AND user_id = ?",
              args: [extra.weekStart, extra.effectiveDate, extra.id, req.userId!],
            }))
          );
        }
      }

      await transaction.execute({ sql: `UPDATE users SET ${setClauses.join(", ")} WHERE id = @id`, args: params });
      const result = await transaction.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.userId!] });
      row = result.rows[0] as unknown as UserRow;
      if (nextWeekStart && nextWeekStart !== current.week_starts_on) {
        const extras = await transaction.execute({
          sql: "SELECT * FROM week_extras WHERE user_id = ? ORDER BY week_start",
          args: [req.userId!],
        });
        reassociatedExtras = (extras.rows as unknown as WeekExtraRow[]).map(toPublicWeekExtra);
      }
      await transaction.commit();
    } finally {
      transaction.close();
    }
    res.json({ user: toPublicUser(row), ...(reassociatedExtras ? { extras: reassociatedExtras } : {}) });
  })
);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  // Not .trim()'d, same reasoning as signup — see security/passwordPolicy.ts.
  newPassword: z.string().superRefine((value, ctx) => {
    const result = validatePassword(value);
    if (!result.valid) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.error ?? "Invalid password" });
    }
  }),
});

/**
 * Changes the signed-in user's password. Responds `204 No Content` per the
 * task's required contract, but a password change also has to invalidate
 * every other JWT issued for this account (see auth.ts's tokenVersion
 * check) *and* every database session backing one — including the session
 * the caller is using right now. Rather than force a re-login for the
 * request that just succeeded, a fresh session is created for this device
 * and its JWT is returned in the `X-New-Token` response header instead of a
 * JSON body, so the 204 stays a true empty-body response while the current
 * device can still pick the new token up and keep going. `app.ts` exposes
 * this header cross-origin via CORS `exposedHeaders` so the browser can
 * actually read it.
 *
 * The password/token_version update, revoking every existing session, and
 * creating the replacement session are all one `db.batch` "write"
 * transaction — see the comment above that call for why the revoke has to
 * run before the insert, not just alongside it.
 */
meRouter.patch(
  "/password",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { currentPassword, newPassword } = parsed.data;

    const result = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.userId!] });
    const row = result.rows[0] as unknown as UserRow | undefined;
    // Shouldn't happen for an authenticated request (requireAuth already
    // confirmed the account exists), but a generic 401 rather than a 404
    // avoids leaking anything about account state either way.
    if (!row) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    if (!(await verifyPassword(currentPassword, row.password_hash))) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    if (await verifyPassword(newPassword, row.password_hash)) {
      res.status(400).json({ error: "New password must be different from your current password" });
      return;
    }

    const newPasswordHash = await hashPassword(newPassword);
    const newTokenVersion = row.token_version + 1;
    const newSessionId = randomUUID();
    const { userAgent, ipAddress } = extractClientInfo(req);
    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

    // The replacement session inherits this device's installation id. It is
    // the same physical installation — only the password changed — so
    // dropping the id here would leave a session nothing can match against,
    // and the next login from this device would start a duplicate entry in
    // the sessions list rather than rotating this one.
    const currentSession = await db.execute({
      sql: "SELECT device_installation_id FROM user_sessions WHERE id = ? AND user_id = ?",
      args: [req.sessionId!, req.userId!],
    });
    const deviceInstallationId =
      (currentSession.rows[0] as unknown as { device_installation_id: string | null } | undefined)
        ?.device_installation_id ?? null;

    await db.batch(
      [
        {
          sql: "UPDATE users SET password_hash = ?, token_version = ? WHERE id = ?",
          args: [newPasswordHash, newTokenVersion, req.userId!],
        },
        // A link requested before this authenticated password change must
        // not remain able to replace the newly chosen password afterwards.
        {
          sql: `UPDATE password_reset_tokens SET invalidated_at = ?
                WHERE user_id = ? AND used_at IS NULL AND invalidated_at IS NULL`,
          args: [nowIso, req.userId!],
        },
        // Must run BEFORE the INSERT below, in the same transaction: this
        // revokes every currently-unrevoked session for the user, and the
        // new session created next must not be caught by that same sweep.
        {
          sql: "UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
          args: [nowIso, req.userId!],
        },
        {
          sql: `INSERT INTO user_sessions
                  (id, user_id, user_agent, ip_address, created_at, last_seen_at, expires_at, device_installation_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [newSessionId, req.userId!, userAgent, ipAddress, nowIso, nowIso, expiresAt, deviceInstallationId],
        },
      ],
      "write"
    );

    const replacementToken = signToken(req.userId!, newTokenVersion, newSessionId);
    res.setHeader("X-New-Token", replacementToken);
    res.status(204).end();
  })
);

const deleteSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

// Permanently deletes the account and every row that references it. Every referencing
// table is deleted explicitly (not just relying on ON DELETE CASCADE) as a safety net:
// foreign-key enforcement on a remote libSQL/Turso connection isn't guaranteed to behave
// identically to local SQLite, so this doesn't assume the cascade fires. Covered by
// backend/test/account-deletion.test.ts, which asserts all five tables end up empty
// (including user_sessions, so a deleted account can never be reached through an old
// still-valid-looking token either).
meRouter.delete(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }

    const result = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.userId!] });
    const row = result.rows[0] as unknown as UserRow | undefined;
    if (!row) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (!(await verifyPassword(parsed.data.password, row.password_hash))) {
      res.status(401).json({ error: "Incorrect password" });
      return;
    }

    await db.batch(
      [
        { sql: "DELETE FROM personal_expenses WHERE user_id = ?", args: [req.userId!] },
        { sql: "DELETE FROM spending_categories WHERE user_id = ?", args: [req.userId!] },
        { sql: "DELETE FROM shifts WHERE user_id = ?", args: [req.userId!] },
        { sql: "DELETE FROM day_expenses WHERE user_id = ?", args: [req.userId!] },
        { sql: "DELETE FROM work_locations WHERE user_id = ?", args: [req.userId!] },
        { sql: "DELETE FROM week_extras WHERE user_id = ?", args: [req.userId!] },
        { sql: "DELETE FROM password_reset_tokens WHERE user_id = ?", args: [req.userId!] },
        { sql: "DELETE FROM user_sessions WHERE user_id = ?", args: [req.userId!] },
        { sql: "DELETE FROM users WHERE id = ?", args: [req.userId!] },
      ],
      "write"
    );
    res.status(204).end();
  })
);
