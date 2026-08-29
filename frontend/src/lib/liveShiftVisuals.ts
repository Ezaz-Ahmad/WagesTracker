import type { DayComputed, WeekSummary } from "./aggregate";
import { fmt2 } from "./date";
import type { SpendingSummary } from "./types";

/**
 * Adds an open shift's elapsed time to the day it started without mutating
 * the settled API data. Open shifts deliberately have no computed hours
 * until sign-out, so every live chart uses this view model instead of
 * teaching each screen its own slightly different version of the math.
 */
export function withLiveDay(
  days: DayComputed[],
  shiftDate: string | null,
  liveHours: number,
  rate: number,
  currency: string
): DayComputed[] {
  if (!shiftDate || liveHours <= 0) return days;
  return days.map((day) => {
    if (day.dateISO !== shiftDate) return day;
    const hours = day.hours + liveHours;
    return {
      ...day,
      hours,
      hoursLabel: `${fmt2(hours)}h`,
      moneyLabel: `${currency}${fmt2(hours * rate + day.fuelCost)}`,
    };
  });
}

/** Adds live time to the current month/year item used by comparison bars. */
export function withLiveInProgressPeriod(
  items: WeekSummary[],
  liveHours: number,
  rate: number
): WeekSummary[] {
  if (liveHours <= 0) return items;
  return items.map((item) => item.inProgress
    ? {
        ...item,
        hours: item.hours + liveHours,
        earnings: item.earnings + liveHours * rate,
      }
    : item);
}

/**
 * Spending categories and the spending donut do not change while working,
 * but the earnings comparison does. This derives a live summary while
 * leaving cached server data untouched.
 */
export function withLiveSpendingEarnings(
  summary: SpendingSummary,
  liveHours: number,
  rate: number
): SpendingSummary {
  const liveEarningsCents = Math.max(0, Math.round(liveHours * rate * 100));
  if (liveEarningsCents === 0) return summary;
  const earningsCents = summary.earningsCents + liveEarningsCents;
  const differenceCents = earningsCents - summary.totalSpendingCents;
  return {
    ...summary,
    earningsCents,
    earningsRecorded: earningsCents > 0,
    differenceCents,
    spendingPercentage: earningsCents > 0
      ? (summary.totalSpendingCents / earningsCents) * 100
      : null,
  };
}

export function isDateInRange(dateISO: string | null, from: string, to: string): boolean {
  return !!dateISO && dateISO >= from && dateISO <= to;
}
