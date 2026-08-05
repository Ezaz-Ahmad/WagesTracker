import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { db, pruneExpiredShifts } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { toPublicWeekExtra, type WeekExtraRow } from "../types.js";

export const weekExtrasRouter = Router();
weekExtrasRouter.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

weekExtrasRouter.get(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await pruneExpiredShifts();
    const from = typeof req.query.from === "string" && DATE_RE.test(req.query.from) ? req.query.from : null;
    const to = typeof req.query.to === "string" && DATE_RE.test(req.query.to) ? req.query.to : null;

    let query = "SELECT * FROM week_extras WHERE user_id = ?";
    const params: unknown[] = [req.userId!];
    if (from) {
      query += " AND week_start >= ?";
      params.push(from);
    }
    if (to) {
      query += " AND week_start <= ?";
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

    if (amount === 0) {
      await db.execute({
        sql: "DELETE FROM week_extras WHERE user_id = ? AND week_start = ?",
        args: [req.userId!, weekStart],
      });
      res.json({ extra: null });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: "A reason is required for other earnings" });
      return;
    }

    const id = randomUUID();
    await db.execute({
      sql: `INSERT INTO week_extras (id, user_id, week_start, amount, reason, created_at, updated_at)
            VALUES (@id, @userId, @weekStart, @amount, @reason, @now, @now)
            ON CONFLICT(user_id, week_start) DO UPDATE SET amount = @amount, reason = @reason, updated_at = @now`,
      args: { id, userId: req.userId!, weekStart, amount, reason, now },
    });

    const result = await db.execute({
      sql: "SELECT * FROM week_extras WHERE user_id = ? AND week_start = ?",
      args: [req.userId!, weekStart],
    });
    const row = result.rows[0] as unknown as WeekExtraRow;
    res.json({ extra: toPublicWeekExtra(row) });
  })
);
