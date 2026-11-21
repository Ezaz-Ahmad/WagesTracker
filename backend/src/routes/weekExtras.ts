import { jobScope } from "../jobs.js";
import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { db, pruneExpiredShifts } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { toPublicWeekExtra, type WeekExtraRow } from "../types.js";
import { addIsoDays, startOfWeekISO, type WeekStart } from "../weekBoundary.js";

export const weekExtrasRouter = Router();
weekExtrasRouter.use(requireAuth, jobScope);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

weekExtrasRouter.get(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await pruneExpiredShifts();
    const from = typeof req.query.from === "string" && DATE_RE.test(req.query.from) ? req.query.from : null;
    const to = typeof req.query.to === "string" && DATE_RE.test(req.query.to) ? req.query.to : null;

    let query = "SELECT * FROM week_extras WHERE user_id = ?";
    if(req.jobId) query += " AND COALESCE(job_id,'job_' || user_id) = ?";
    const params: unknown[] = req.jobId ? [req.userId!,req.jobId] : [req.userId!];
    if (from) {
      query += req.jobId ? " AND week_start >= ?" : " AND effective_date >= ?";
      params.push(from);
    }
    if (to) {
      query += req.jobId ? " AND week_start <= ?" : " AND effective_date <= ?";
      params.push(to);
    }
    query += " ORDER BY week_start ASC";

    const result = await db.execute({ sql: query, args: params as (string | number)[] });
    const rows = result.rows as unknown as WeekExtraRow[];
    res.json({ extras: rows.map(toPublicWeekExtra) });
  })
);

// Upsert-by-week-start: one entry per week (identified by that week's start
// date, per the user's weekStartsOn setting), not per shift or per day — this
// is a single lump amount like a tip, bonus, or reimbursement for the whole
// week, and it always needs a reason. Sending amount: null clears the entry.
const putSchema = z.object({
  amount: z.number().min(0).max(100000).nullable(),
  reason: z.string().trim().max(300).optional().default(""),
});

weekExtrasRouter.put(
  "/:weekStart",
  asyncHandler<AuthedRequest>(async (req, res) => {
    if (!DATE_RE.test(req.params.weekStart)) {
      res.status(400).json({ error: "weekStart must be YYYY-MM-DD" });
      return;
    }
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const amount = parsed.data.amount ?? 0;
    const reason = parsed.data.reason;
    const weekStart = req.params.weekStart;
    const now = new Date().toISOString();

    // Boundary validation and the write share one transaction. Otherwise a
    // concurrent profile change could occur after validation but before the
    // upsert, leaving a freshly written extra keyed to the old weekday.
    const transaction = await db.transaction("write");
    try {
      const userResult = await transaction.execute({
        sql: "SELECT week_starts_on FROM jobs WHERE id = ? AND user_id = ?",
        args: [req.jobId!,req.userId!],
      });
      const user = userResult.rows[0] as unknown as { week_starts_on: WeekStart } | undefined;
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }
      if (startOfWeekISO(weekStart, user.week_starts_on) !== weekStart) {
        res.status(400).json({ error: `weekStart must be a ${user.week_starts_on}` });
        return;
      }

      if (amount === 0) {
        await transaction.execute({
          sql: "DELETE FROM week_extras WHERE user_id = ? AND week_start = ? AND COALESCE(job_id,'job_' || user_id) = ?",
          args: [req.userId!, weekStart, req.jobId!],
        });
        await transaction.commit();
        res.json({ extra: null });
        return;
      }
      if (!reason) {
        res.status(400).json({ error: "A reason is required for other earnings" });
        return;
      }

      const id = randomUUID();
      const effectiveDate = addIsoDays(weekStart, 6);
      await transaction.execute({
        sql: `INSERT INTO week_extras (id, user_id, job_id, week_start, effective_date, amount, reason, created_at, updated_at)
              VALUES (@id, @userId, @jobId, @weekStart, @effectiveDate, @amount, @reason, @now, @now)
              ON CONFLICT(user_id, job_id, week_start) DO UPDATE SET amount = @amount, reason = @reason, updated_at = @now`,
        args: { id, userId: req.userId!, jobId:req.jobId!, weekStart, effectiveDate, amount, reason, now },
      });

      const result = await transaction.execute({
        sql: "SELECT * FROM week_extras WHERE user_id = ? AND week_start = ? AND COALESCE(job_id,'job_' || user_id) = ?",
        args: [req.userId!, weekStart, req.jobId!],
      });
      const row = result.rows[0] as unknown as WeekExtraRow;
      await transaction.commit();
      res.json({ extra: toPublicWeekExtra(row) });
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
      res.status(400).json({ error: "weekStart must be a real calendar date" });
    } finally {
      transaction.close();
    }
  })
);
