import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { db, pruneExpiredShifts } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { toPublicDayExpense, type DayExpenseRow } from "../types.js";

export const dayExpensesRouter = Router();
dayExpensesRouter.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

dayExpensesRouter.get(
  "/",
  asyncHandler<AuthedRequest>(async (req, res) => {
    await pruneExpiredShifts();
    const from = typeof req.query.from === "string" && DATE_RE.test(req.query.from) ? req.query.from : null;
    const to = typeof req.query.to === "string" && DATE_RE.test(req.query.to) ? req.query.to : null;

    let query = "SELECT * FROM day_expenses WHERE user_id = ?";
    const params: unknown[] = [req.userId!];
    if (from) {
      query += " AND date >= ?";
      params.push(from);
    }
    if (to) {
      query += " AND date <= ?";
      params.push(to);
    }
    query += " ORDER BY date ASC";

    const result = await db.execute({ sql: query, args: params as (string | number)[] });
    const rows = result.rows as unknown as DayExpenseRow[];
    res.json({ expenses: rows.map(toPublicDayExpense) });
  })
);

// Upsert-by-date: the amount box lives per calendar day, not per shift, so the
// client always addresses it by date rather than a record id. Sending
// fuelCost: null clears the entry (unticking the checkbox).
const putSchema = z.object({
  fuelCost: z.number().min(0).max(100000).nullable(),
});

dayExpensesRouter.put(
  "/:date",
  asyncHandler<AuthedRequest>(async (req, res) => {
    if (!DATE_RE.test(req.params.date)) {
      res.status(400).json({ error: "date must be YYYY-MM-DD" });
      return;
    }
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const fuelCost = parsed.data.fuelCost ?? 0;
    const date = req.params.date;
    const now = new Date().toISOString();

    if (fuelCost === 0) {
      await db.execute({
        sql: "DELETE FROM day_expenses WHERE user_id = ? AND date = ?",
        args: [req.userId!, date],
      });
      res.json({ expense: null });
      return;
    }

    const id = randomUUID();
    await db.execute({
      sql: `INSERT INTO day_expenses (id, user_id, date, fuel_cost, created_at, updated_at)
            VALUES (@id, @userId, @date, @fuelCost, @now, @now)
            ON CONFLICT(user_id, date) DO UPDATE SET fuel_cost = @fuelCost, updated_at = @now`,
      args: { id, userId: req.userId!, date, fuelCost, now },
    });

    const result = await db.execute({
      sql: "SELECT * FROM day_expenses WHERE user_id = ? AND date = ?",
      args: [req.userId!, date],
    });
    const row = result.rows[0] as unknown as DayExpenseRow;
    res.json({ expense: toPublicDayExpense(row) });
  })
);
