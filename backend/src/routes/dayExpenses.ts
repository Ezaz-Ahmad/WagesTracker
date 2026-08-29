import { Router } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asyncHandler } from "../asyncHandler.js";
import { db, pruneExpiredShifts } from "../db.js";
import { dollarsToCents, hasAtMostTwoDecimals, MAX_FUEL_ALLOWANCE, recalculateDayFuelAllowance } from "../fuelAllowances.js";
import { requireAuth, type AuthedRequest } from "../auth.js";
import { toPublicDayExpense, type DayExpenseRow } from "../types.js";
import {
  CLIENT_TIME_ZONE_HEADER,
  isSupportedIanaTimeZone,
  isValidDate,
  localDateForTimeZone,
} from "../security/shiftRules.js";

export const dayExpensesRouter = Router();
dayExpensesRouter.use(requireAuth);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const FUTURE_FUEL_DATE_MESSAGE = "You can't record fuel for a future date without confirming it.";

/** Fuel writes predate the client-time-zone requirement used by shift writes,
 * so an omitted header remains compatible with older clients and scripts.
 * New clients send it, which makes the future-date guard use the user's local
 * calendar rather than the server's UTC day. */
function requestLocalDate(req: AuthedRequest): string | null {
  const raw = req.get(CLIENT_TIME_ZONE_HEADER);
  if (!raw) return new Date().toISOString().slice(0, 10);
  if (!isSupportedIanaTimeZone(raw)) return null;
  return localDateForTimeZone(new Date(), raw.trim());
}

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
  fuelCost: z
    .number()
    .min(0)
    .max(MAX_FUEL_ALLOWANCE)
    .refine(hasAtMostTwoDecimals, "Fuel allowance can have at most two decimal places")
    .nullable(),
  allowFutureDate: z.boolean().optional().default(false),
});

dayExpensesRouter.put(
  "/:date",
  asyncHandler<AuthedRequest>(async (req, res) => {
    if (!DATE_RE.test(req.params.date) || !isValidDate(req.params.date)) {
      res.status(400).json({ error: "date must be YYYY-MM-DD" });
      return;
    }
    const localToday = requestLocalDate(req);
    if (!localToday) {
      res.status(400).json({ error: "A valid device time zone is required to save fuel.", code: "INVALID_CLIENT_TIME_ZONE" });
      return;
    }
    const parsed = putSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid input" });
      return;
    }
    const { fuelCost, allowFutureDate } = parsed.data;
    if (req.params.date > localToday && !allowFutureDate) {
      res.status(400).json({ error: FUTURE_FUEL_DATE_MESSAGE });
      return;
    }
    const manualOverrideCents = fuelCost && fuelCost > 0
      ? dollarsToCents(fuelCost)
      : null;
    const date = req.params.date;
    const now = new Date().toISOString();

    const transaction = await db.transaction("write");
    try {
      await recalculateDayFuelAllowance(transaction, req.userId!, date);
      const existing = await transaction.execute({
        sql: "SELECT automatic_fuel_cents FROM day_expenses WHERE user_id = ? AND date = ?",
        args: [req.userId!, date],
      });
      const automaticCents = Number(existing.rows[0]?.automatic_fuel_cents || 0);

      if (manualOverrideCents == null && automaticCents === 0) {
        await transaction.execute({
          sql: "DELETE FROM day_expenses WHERE user_id = ? AND date = ?",
          args: [req.userId!, date],
        });
      } else {
        const effectiveCents = manualOverrideCents ?? automaticCents;
        await transaction.execute({
          sql: `INSERT INTO day_expenses
                (id, user_id, date, fuel_cost, automatic_fuel_cents, manual_override_cents, created_at, updated_at)
                VALUES (@id, @userId, @date, @fuelCost, @automaticCents, @manualOverrideCents, @now, @now)
                ON CONFLICT(user_id, date) DO UPDATE SET
                  fuel_cost = @fuelCost,
                  automatic_fuel_cents = @automaticCents,
                  manual_override_cents = @manualOverrideCents,
                  updated_at = @now`,
          args: {
            id: randomUUID(),
            userId: req.userId!,
            date,
            fuelCost: effectiveCents / 100,
            automaticCents,
            manualOverrideCents,
            now,
          },
        });
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    } finally {
      transaction.close();
    }

    const result = await db.execute({
      sql: "SELECT * FROM day_expenses WHERE user_id = ? AND date = ?",
      args: [req.userId!, date],
    });
    const row = result.rows[0] as unknown as DayExpenseRow | undefined;
    res.json({ expense: row ? toPublicDayExpense(row) : null });
  })
);
