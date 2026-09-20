import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAdmin, signAdminToken, verifyAdminPassword } from "../auth.js";
import { db } from "../db.js";
import { toAdminUserSummary, toPublicShift, toPublicUser, type ShiftRow, type UserRow } from "../types.js";
import { validateEmailAddress } from "../security/emailPolicy.js";
import { sendEmailChangedNotifications, sendNotificationBestEffort } from "../email/emailService.js";

export const adminRouter = Router();

// Brute-forcing a single shared admin password is a much higher-value target than a
// per-user login, so this gets its own tight limiter rather than sharing the general one.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

const loginSchema = z.object({
  password: z.string().min(1, "Password is required"),
});

adminRouter.post(
  "/login",
  adminLoginLimiter,
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    if (!verifyAdminPassword(parsed.data.password)) {
      res.status(401).json({ error: "Incorrect admin password" });
      return;
    }
    res.json({ token: signAdminToken() });
  })
);

adminRouter.use(requireAdmin);

adminRouter.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const result = await db.execute(
      `SELECT u.*, COUNT(s.id) AS shift_count
       FROM users u
       LEFT JOIN shifts s ON s.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
    const rows = result.rows as unknown as (UserRow & { shift_count: unknown })[];
    res.json({ users: rows.map(toAdminUserSummary) });
  })
);

adminRouter.get(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const userResult = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.params.id] });
    const userRow = userResult.rows[0] as unknown as UserRow | undefined;
    if (!userRow) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const shiftsResult = await db.execute({
      sql: "SELECT * FROM shifts WHERE user_id = ? ORDER BY date DESC, created_at DESC",
      args: [req.params.id],
    });
    const shiftRows = shiftsResult.rows as unknown as ShiftRow[];
    res.json({ user: toPublicUser(userRow), shifts: shiftRows.map(toPublicShift) });
  })
);

const adminEmailChangeSchema = z.object({
  email: z.string(),
  acceptEmailAsEntered: z.boolean().optional().default(false),
});

adminRouter.patch(
  "/users/:id/email",
  asyncHandler(async (req, res) => {
    const parsed = adminEmailChangeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const emailCheck = validateEmailAddress(parsed.data.email);
    if (!emailCheck.valid) {
      res.status(400).json({ error: emailCheck.error, code: "INVALID_EMAIL", field: "email" });
      return;
    }
    if (emailCheck.suggestion && !parsed.data.acceptEmailAsEntered) {
      res.status(400).json({
        error: `The part after @ may be misspelled. Did you mean ${emailCheck.suggestion}?`,
        code: "EMAIL_DOMAIN_TYPO",
        field: "email",
        suggestion: emailCheck.suggestion,
      });
      return;
    }

    const userResult = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.params.id] });
    const user = userResult.rows[0] as unknown as UserRow | undefined;
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (emailCheck.normalized === user.email) {
      res.status(400).json({ error: "Enter a different email from the user's current one", code: "EMAIL_UNCHANGED", field: "email" });
      return;
    }
    const duplicate = await db.execute({
      sql: "SELECT id FROM users WHERE email = ? AND id != ?",
      args: [emailCheck.normalized, user.id],
    });
    if (duplicate.rows.length > 0) {
      res.status(409).json({ error: "That email is already used by another account", code: "EMAIL_ALREADY_EXISTS", field: "email" });
      return;
    }

    const nowIso = new Date().toISOString();
    try {
      await db.batch([
        { sql: "UPDATE users SET email = ?, email_verified = 1 WHERE id = ?", args: [emailCheck.normalized, user.id] },
        {
          sql: `UPDATE email_verification_tokens SET invalidated_at = ?
                WHERE user_id = ? AND used_at IS NULL AND invalidated_at IS NULL`,
          args: [nowIso, user.id],
        },
      ], "write");
    } catch (error) {
      if (String(error).toLowerCase().includes("unique")) {
        res.status(409).json({ error: "That email is already used by another account", code: "EMAIL_ALREADY_EXISTS", field: "email" });
        return;
      }
      throw error;
    }

    sendNotificationBestEffort("admin-email-change", () => sendEmailChangedNotifications({
      oldEmail: user.email,
      newEmail: emailCheck.normalized,
      name: user.name,
    }));
    const updated = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [user.id] });
    res.json({
      user: toPublicUser(updated.rows[0] as unknown as UserRow),
      message: "Email updated. The user's password and account data were not changed.",
    });
  })
);

// Same reasoning as the self-service delete in routes/me.ts: every referencing table is
// deleted explicitly rather than relying solely on ON DELETE CASCADE, since FK enforcement
// on a remote libSQL/Turso connection isn't guaranteed to behave identically to local
// SQLite. Covered by backend/test/admin.test.ts, which asserts all four tables end up empty.
adminRouter.delete(
  "/users/:id",
  asyncHandler(async (req, res) => {
    const existing = await db.execute({ sql: "SELECT id FROM users WHERE id = ?", args: [req.params.id] });
    if (existing.rows.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    await db.batch(
      [
        { sql: "DELETE FROM personal_expenses WHERE user_id = ?", args: [req.params.id] },
        { sql: "DELETE FROM spending_categories WHERE user_id = ?", args: [req.params.id] },
        { sql: "DELETE FROM shifts WHERE user_id = ?", args: [req.params.id] },
        { sql: "DELETE FROM day_expenses WHERE user_id = ?", args: [req.params.id] },
        { sql: "DELETE FROM work_locations WHERE user_id = ?", args: [req.params.id] },
        { sql: "DELETE FROM week_extras WHERE user_id = ?", args: [req.params.id] },
        { sql: "DELETE FROM password_reset_tokens WHERE user_id = ?", args: [req.params.id] },
        { sql: "DELETE FROM email_verification_tokens WHERE user_id = ?", args: [req.params.id] },
        { sql: "DELETE FROM user_sessions WHERE user_id = ?", args: [req.params.id] },
        { sql: "DELETE FROM users WHERE id = ?", args: [req.params.id] },
      ],
      "write"
    );
    res.status(204).end();
  })
);
