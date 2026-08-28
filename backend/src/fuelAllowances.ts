import type { Client, Transaction } from "@libsql/client";
import { randomUUID } from "node:crypto";

type DatabaseExecutor = Pick<Client, "execute"> | Pick<Transaction, "execute">;

export const MAX_FUEL_ALLOWANCE = 10_000;

export function hasAtMostTwoDecimals(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
}

export function dollarsToCents(value: number): number {
  return Math.round(value * 100);
}

/**
 * Rebuilds the persisted daily fuel total from saved, worked shifts. A branch
 * contributes at most once per date even when that date has split shifts.
 * The snapshot on each shift, rather than the branch's current setting, is
 * used so edits to a branch never rewrite historical earnings.
 */
export async function recalculateDayFuelAllowance(
  database: DatabaseExecutor,
  userId: string,
  date: string
): Promise<void> {
  const automaticResult = await database.execute({
    sql: `SELECT work_location_id, MAX(fuel_allowance_snapshot_cents) AS allowance_cents
          FROM shifts
          WHERE user_id = ? AND date = ?
            AND sign_in IS NOT NULL
            AND work_location_id IS NOT NULL
            AND fuel_allowance_snapshot_cents IS NOT NULL
            AND fuel_allowance_snapshot_cents > 0
          GROUP BY work_location_id`,
    args: [userId, date],
  });
  const automaticCents = automaticResult.rows.reduce(
    (total, row) => total + Number(row.allowance_cents || 0),
    0
  );

  const existingResult = await database.execute({
    sql: "SELECT id, manual_override_cents FROM day_expenses WHERE user_id = ? AND date = ?",
    args: [userId, date],
  });
  const existing = existingResult.rows[0] as unknown as
    | { id: string; manual_override_cents: number | null }
    | undefined;
  const manualCents = existing?.manual_override_cents == null
    ? null
    : Number(existing.manual_override_cents);

  if (!existing && automaticCents === 0) return;
  if (existing && automaticCents === 0 && manualCents == null) {
    await database.execute({ sql: "DELETE FROM day_expenses WHERE id = ?", args: [existing.id] });
    return;
  }

  const now = new Date().toISOString();
  const effectiveCents = manualCents ?? automaticCents;
  await database.execute({
    sql: `INSERT INTO day_expenses
          (id, user_id, date, fuel_cost, automatic_fuel_cents, manual_override_cents, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, date) DO UPDATE SET
            fuel_cost = excluded.fuel_cost,
            automatic_fuel_cents = excluded.automatic_fuel_cents,
            updated_at = excluded.updated_at`,
    args: [
      existing?.id ?? randomUUID(),
      userId,
      date,
      effectiveCents / 100,
      automaticCents,
      manualCents,
      now,
      now,
    ],
  });
}
