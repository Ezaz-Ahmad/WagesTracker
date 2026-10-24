import type { Client } from "@libsql/client";
import { completedShiftHours } from "./earnings.js";
import type { AdminEarningsDay, AdminWeekEarnings, UserRow } from "./types.js";
import { addIsoDays, startOfWeekISO, weekDayIndex } from "./weekBoundary.js";

type EarningsUser = Pick<UserRow, "id" | "rate" | "week_starts_on">;
export interface AdminEarningsPair {
  week: AdminWeekEarnings;
  previousWeek: AdminWeekEarnings;
}

const money = (amount: number) => Math.round(amount * 100) / 100;
const hours = (amount: number) => Math.round(amount * 1_000_000) / 1_000_000;

function emptyWeek(weekStart: string): AdminWeekEarnings {
  return {
    weekStart,
    weekEnd: addIsoDays(weekStart, 6),
    hours: 0,
    wages: 0,
    fuel: 0,
    extras: 0,
    total: 0,
    shiftCount: 0,
    completedShiftCount: 0,
    openShiftCount: 0,
    days: Array.from({ length: 7 }, (_, index) => ({
      date: addIsoDays(weekStart, index),
      hours: 0,
      wages: 0,
      fuel: 0,
      total: 0,
      shiftCount: 0,
      openShiftCount: 0,
    })),
  };
}

function finishWeek(week: AdminWeekEarnings, rate: number): void {
  for (const day of week.days) {
    day.hours = hours(day.hours);
    day.fuel = money(day.fuel);
    day.total = money(day.hours * rate + day.fuel);
    day.wages = money(day.total - day.fuel);
  }
  week.hours = hours(week.hours);
  week.fuel = money(week.fuel);
  week.extras = money(week.extras);
  // Exactly the canonical earningsForRange formula. Derive displayed wages
  // from that rounded total so the monetary breakdown always adds up, even
  // at a floating-point half-cent boundary. Daily values round separately.
  week.total = money(week.hours * rate + week.fuel + week.extras);
  week.wages = money(week.total - week.fuel - week.extras);
}

/**
 * A fixed three data reads serves the whole directory, regardless of its user
 * count. Only the two requested weeks (at most 20 calendar days across all
 * seven preferences) are loaded; historical shifts never enter this query.
 * Detail calls additionally scope every read to their one requested user.
 */
export async function adminEarningsForUsers(
  database: Client,
  users: readonly EarningsUser[],
  anchor: string,
  onlyUserId?: string
): Promise<Map<string, AdminEarningsPair>> {
  const pairs = new Map<string, AdminEarningsPair>();
  const days = new Map<string, Map<string, { day: AdminEarningsDay; week: AdminWeekEarnings }>>();
  for (const user of users) {
    const currentStart = startOfWeekISO(anchor, user.week_starts_on);
    const pair = { week: emptyWeek(currentStart), previousWeek: emptyWeek(addIsoDays(currentStart, -7)) };
    pairs.set(user.id, pair);
    const userDays = new Map<string, { day: AdminEarningsDay; week: AdminWeekEarnings }>();
    for (const week of [pair.previousWeek, pair.week]) {
      for (const day of week.days) userDays.set(day.date, { day, week });
    }
    days.set(user.id, userDays);
  }
  if (pairs.size === 0) return pairs;

  const from = [...pairs.values()].map((pair) => pair.previousWeek.weekStart).sort()[0];
  const to = [...pairs.values()].map((pair) => pair.week.weekEnd).sort().at(-1)!;
  const userFilter = onlyUserId ? " AND user_id = ?" : "";
  const args = onlyUserId ? [from, to, onlyUserId] : [from, to];
  const [shiftResult, fuelResult, extrasResult] = await Promise.all([
    database.execute({
      sql: `SELECT user_id, date, sign_in, sign_out FROM shifts WHERE date >= ? AND date <= ?${userFilter}`,
      args,
    }),
    database.execute({
      sql: `SELECT user_id, date, fuel_cost FROM day_expenses WHERE date >= ? AND date <= ?${userFilter}`,
      args,
    }),
    database.execute({
      sql: `SELECT user_id, week_start, amount FROM week_extras WHERE week_start >= ? AND week_start <= ?${userFilter}`,
      args,
    }),
  ]);

  for (const row of shiftResult.rows) {
    const target = days.get(String(row.user_id))?.get(String(row.date));
    if (!target) continue;
    const signIn = row.sign_in == null ? null : String(row.sign_in);
    const signOut = row.sign_out == null ? null : String(row.sign_out);
    target.day.shiftCount++;
    target.week.shiftCount++;
    if (signIn && signOut) {
      const shiftHours = completedShiftHours(signIn, signOut);
      target.day.hours += shiftHours;
      target.week.hours += shiftHours;
      target.week.completedShiftCount++;
    } else {
      target.day.openShiftCount++;
      target.week.openShiftCount++;
    }
  }
  for (const row of fuelResult.rows) {
    const target = days.get(String(row.user_id))?.get(String(row.date));
    if (!target) continue;
    const fuel = Number(row.fuel_cost ?? 0);
    target.day.fuel += fuel;
    target.week.fuel += fuel;
  }
  for (const row of extrasResult.rows) {
    const target = days.get(String(row.user_id))?.get(String(row.week_start));
    if (target) target.week.extras += Number(row.amount ?? 0);
  }
  for (const user of users) {
    const pair = pairs.get(user.id)!;
    finishWeek(pair.week, Number(user.rate));
    finishWeek(pair.previousWeek, Number(user.rate));
  }
  return pairs;
}

/** Return week keys rather than loading a user's full historical shifts. */
export async function adminAvailableWeeks(
  database: Client,
  user: EarningsUser,
  anchor: string,
  today = new Date().toISOString().slice(0, 10)
): Promise<string[]> {
  const result = await database.execute({
    sql: `SELECT DISTINCT date(record_date, '-' ||
            ((CAST(strftime('%w', record_date) AS INTEGER) - ? + 7) % 7) || ' days') AS week_start
          FROM (
            SELECT date AS record_date FROM shifts WHERE user_id = ?
            UNION SELECT date FROM day_expenses WHERE user_id = ?
            UNION SELECT week_start FROM week_extras WHERE user_id = ?
          )`,
    args: [weekDayIndex(user.week_starts_on), user.id, user.id, user.id],
  });
  const weeks = new Set([
    startOfWeekISO(today, user.week_starts_on),
    startOfWeekISO(anchor, user.week_starts_on),
  ]);
  for (const row of result.rows) {
    if (typeof row.week_start === "string") weeks.add(row.week_start);
  }
  return [...weeks].sort().reverse();
}
