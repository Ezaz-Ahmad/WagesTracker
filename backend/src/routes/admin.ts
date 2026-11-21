import { userJobs,publicJob,publicRate,type RateRow } from "../jobs.js";
import { toPublicWorkLocation,type WorkLocationRow } from "../types.js";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { requireAdmin, signAdminToken, verifyAdminPassword } from "../auth.js";
import { db } from "../db.js";
import { toAdminUserSummary, toPublicShift, toPublicUser, type ShiftRow, type UserRow } from "../types.js";
import { validateEmailAddress } from "../security/emailPolicy.js";
import { sendEmailChangedNotifications, sendNotificationBestEffort } from "../email/emailService.js";
import { adminAvailableWeeks, adminEarningsForUsers } from "../adminEarnings.js";
import { isValidDate } from "../security/shiftRules.js";

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

const adminDateError = "date must be a real calendar date in YYYY-MM-DD form";
function earningsAnchor(value: unknown): string | null {
  if (value === undefined) return new Date().toISOString().slice(0, 10);
  return typeof value === "string" && isValidDate(value) ? value : null;
}

adminRouter.get(
  "/users",
  asyncHandler(async (req, res) => {
    const anchor = earningsAnchor(req.query.date);
    if (!anchor) {
      res.status(400).json({ error: adminDateError });
      return;
    }
    const result = await db.execute(
      `SELECT u.*, COUNT(s.id) AS shift_count, (SELECT COUNT(*) FROM jobs j WHERE j.user_id=u.id) AS job_count, (SELECT COUNT(*) FROM jobs j WHERE j.user_id=u.id AND j.archived_at IS NULL) AS active_job_count,
         (SELECT week_starts_on FROM jobs j WHERE j.user_id=u.id AND j.is_primary=1) AS primary_week_starts_on,
         (SELECT rate_cents/100.0 FROM pay_rates p JOIN jobs j ON j.id=p.job_id WHERE j.user_id=u.id AND j.is_primary=1 AND p.location_id IS NULL AND p.effective_from<=date('now') ORDER BY p.effective_from DESC LIMIT 1) AS current_default_rate
       FROM users u
       LEFT JOIN shifts s ON s.user_id = u.id
       GROUP BY u.id
       ORDER BY u.created_at DESC`
    );
    const rows = result.rows.map(raw=>({...raw,
      week_starts_on:Number(raw.job_count)>1?"Monday":raw.primary_week_starts_on??raw.week_starts_on,
      rate:raw.current_default_rate??raw.rate,
    })) as unknown as (UserRow & { shift_count: unknown })[];
    const earnings = await adminEarningsForUsers(db, rows, anchor);
    res.json({ users: rows.map((row) => {
      const pair = earnings.get(row.id)!;
      return {...toAdminUserSummary(row, pair.week, pair.previousWeek),jobCount:Number((row as unknown as {job_count:number}).job_count)||1,activeJobCount:Number((row as unknown as {active_job_count:number}).active_job_count)||1};
    }) });
  })
);

adminRouter.get(
  "/users/:id/earnings",
  asyncHandler(async (req, res) => {
    const anchor = earningsAnchor(req.query.date);
    if (!anchor) {
      res.status(400).json({ error: adminDateError });
      return;
    }
    const userResult = await db.execute({ sql: "SELECT * FROM users WHERE id = ?", args: [req.params.id] });
    const user = userResult.rows[0] as unknown as UserRow | undefined;
    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    const jobs=await userJobs(user.id);
    const jobId=typeof req.query.jobId==="string"&&req.query.jobId!=="all"?req.query.jobId:undefined;
    const selected=jobId?jobs.find(j=>j.id===jobId):undefined;
    if(jobId&&!selected){res.status(404).json({error:"Job not found for this user"});return;}
    const scopedUser={...user,week_starts_on:selected?.week_starts_on??(jobs.length>1?"Monday" as const:jobs[0]?.week_starts_on??user.week_starts_on)};
    const [earnings, availableWeeks,byJob] = await Promise.all([
      adminEarningsForUsers(db, [scopedUser], anchor, user.id,{jobId}),
      adminAvailableWeeks(db, scopedUser, anchor,undefined,jobId),
      adminEarningsForUsers(db,jobs.map(j=>({id:j.id,rate:user.rate,week_starts_on:scopedUser.week_starts_on})),anchor,user.id,{groupByJob:true}),
    ]);
    res.json({ ...earnings.get(user.id)!, availableWeeks,weekStartsOn:scopedUser.week_starts_on,jobs:await Promise.all(jobs.map(async j=>({...await publicJob(j,new Date().toISOString().slice(0,10)),earnings:byJob.get(j.id)?.week}))) });
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
    const jobs=await userJobs(userRow.id);
    const [locations,rates]=await Promise.all([db.execute({sql:"SELECT * FROM work_locations WHERE user_id=? ORDER BY name",args:[userRow.id]}),db.execute({sql:"SELECT * FROM pay_rates WHERE user_id=? ORDER BY effective_from DESC",args:[userRow.id]})]);
    res.json({ user: toPublicUser(userRow), shifts: shiftRows.map(toPublicShift),jobs:await Promise.all(jobs.map(j=>publicJob(j,new Date().toISOString().slice(0,10)))),locations:(locations.rows as unknown as WorkLocationRow[]).map(toPublicWorkLocation),rates:(rates.rows as unknown as RateRow[]).map(publicRate) });
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
        { sql: "DELETE FROM pay_rates WHERE user_id = ?", args: [req.params.id] },
        { sql: "DELETE FROM jobs WHERE user_id = ?", args: [req.params.id] },
        { sql: "DELETE FROM users WHERE id = ?", args: [req.params.id] },
      ],
      "write"
    );
    res.status(204).end();
  })
);
