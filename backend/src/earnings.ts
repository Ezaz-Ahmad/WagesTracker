import type { Client } from "@libsql/client";
import { durationSeconds } from "./security/shiftRules.js";

interface EarningsShiftRow {
  sign_in: string | null;
  sign_out: string | null;
}

/**
 * Canonical persisted earnings for a plain-calendar date range.
 *
 * This intentionally mirrors the app's established formula exactly: each
 * completed shift contributes its elapsed hours at the user's current rate,
 * fuel reimbursements are added from `day_expenses`, and weekly extras whose
 * week-start falls inside the range are added once. Open shifts contribute
 * zero until completed, just as History and generated wage reports do.
 */
export async function earningsForRange(
  database: Client,
  userId: string,
  from: string,
  to: string
): Promise<{ earningsCents: number; hours: number; fuelCents: number; extrasCents: number; hasRecords: boolean }> {
  const [userResult, shiftResult, fuelResult, extrasResult] = await Promise.all([
    database.execute({ sql: "SELECT rate FROM users WHERE id = ?", args: [userId] }),
    database.execute({
      sql: "SELECT sign_in, sign_out FROM shifts WHERE user_id = ? AND date >= ? AND date <= ?",
      args: [userId, from, to],
    }),
    database.execute({
      sql: "SELECT fuel_cost FROM day_expenses WHERE user_id = ? AND date >= ? AND date <= ?",
      args: [userId, from, to],
    }),
    database.execute({
      sql: "SELECT amount FROM week_extras WHERE user_id = ? AND week_start >= ? AND week_start <= ?",
      args: [userId, from, to],
    }),
  ]);

  const rate = Number(userResult.rows[0]?.rate ?? 0);
  const shiftRows = shiftResult.rows as unknown as EarningsShiftRow[];
  const hours = Math.round(
    shiftRows.reduce((total, shift) => {
      if (!shift.sign_in || !shift.sign_out) return total;
      const shiftHours = Math.round((durationSeconds(shift.sign_in, shift.sign_out) / 3600) * 1_000_000) / 1_000_000;
      return total + shiftHours;
    }, 0) * 1_000_000
  ) / 1_000_000;
  const fuel = Math.round(fuelResult.rows.reduce((total, row) => total + Number(row.fuel_cost ?? 0), 0) * 100) / 100;
  const extras = Math.round(extrasResult.rows.reduce((total, row) => total + Number(row.amount ?? 0), 0) * 100) / 100;
  const earnings = Math.round((hours * rate + fuel + extras) * 100) / 100;

  return {
    earningsCents: Math.round(earnings * 100),
    hours,
    fuelCents: Math.round(fuel * 100),
    extrasCents: Math.round(extras * 100),
    hasRecords: shiftRows.length > 0 || fuelResult.rows.length > 0 || extrasResult.rows.length > 0,
  };
}
