import { weekEarningsFor } from "./aggregate";
import { addDays, startOfWeek } from "./date";
import type { DayExpense, Shift, WeekExtra, WeekStart } from "./types";

/**
 * The "vs prior week" figure under the Home headline.
 *
 * It replaces an expression that was wrong in four separate ways, all of
 * which showed up on screen as a permanent red "▲ 0% vs prior week":
 *
 *  1. It compared the wrong weeks entirely. `buildWeeklyHistory` builds only
 *     *completed* weeks, so its last two entries are last week and the week
 *     before — the current week, the one the headline is showing, never
 *     entered the comparison at all.
 *  2. It collapsed "no prior data" and "no change" into the same `0`, so a
 *     brand-new account and a genuinely flat week were indistinguishable.
 *  3. `trendUp = pct >= 0` made zero count as an increase, which is where
 *     the upward red arrow on an unchanged value came from.
 *  4. The headline included the in-progress shift's live earnings and the
 *     comparison didn't, so during a shift the two were computed from
 *     different numbers.
 *
 * Everything here derives from `weekEarningsFor`, the same single formula the
 * headline uses, so the two can no longer disagree. The live shift is passed
 * in explicitly and added to the current week only — and when it is, the
 * result is flagged `isEstimate` so the UI can say so rather than presenting
 * a moving number as settled fact.
 */

export type WeekComparisonStatus =
  | "up"
  | "down"
  | "no-change"
  /** A real but sub-1% difference. Reported separately so it never renders as
   * a directional arrow next to "0%", which is what made the old version look
   * broken even when it was arithmetically defensible. */
  | "negligible"
  /** Prior week has records but earned nothing, and this week has earnings. */
  | "new-this-week"
  /** No stored data at all for the prior week — not the same as earning zero. */
  | "no-prior-data"
  /** Neither week has any earnings. */
  | "no-activity";

export interface WeekComparison {
  status: WeekComparisonStatus;
  /** Rounded whole-percent change, or null when a percentage is meaningless
   * (no prior data, division by zero, nothing to compare). Never Infinity. */
  percentChange: number | null;
  currentTotal: number;
  /** Null when the prior week has no records at all. */
  previousTotal: number | null;
  /** True when an in-progress shift contributes to `currentTotal`. */
  isEstimate: boolean;
  /** Ready-to-render sentence, without the arrow. */
  label: string;
  /** Which direction, if any, the UI should indicate. "none" means no arrow —
   * the case the old code got wrong. */
  direction: "up" | "down" | "none";
}

export interface WeekComparisonInput {
  today: Date;
  weekStartsOn: WeekStart;
  shifts: Shift[];
  dayExpenses: DayExpense[];
  weekExtras: WeekExtra[];
  rate: number;
  /** Earnings from the currently-open shift, already computed by the caller
   * from live elapsed hours. Zero when no shift is running, or when the open
   * shift belongs to a different week (see HomeScreen). */
  liveEarnings?: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Compares the current week against the one immediately before it, under the
 * user's own week-start setting. Pure: given the same inputs it returns the
 * same result, which is what makes every edge case testable without a DOM.
 */
export function compareWeekEarnings(input: WeekComparisonInput): WeekComparison {
  const { today, weekStartsOn, shifts, dayExpenses, weekExtras, rate, liveEarnings = 0 } = input;

  const currentStart = startOfWeek(today, weekStartsOn);
  const previousStart = addDays(currentStart, -7);

  const current = weekEarningsFor(currentStart, shifts, dayExpenses, weekExtras, rate);
  const previous = weekEarningsFor(previousStart, shifts, dayExpenses, weekExtras, rate);

  const currentTotal = round2(current.earnings + liveEarnings);
  const isEstimate = liveEarnings > 0;

  // No records at all for the prior week — a week that predates the account
  // is not a week that earned zero, and saying "down 100%" about it would be
  // an invention.
  if (!previous.hasRecords) {
    if (currentTotal <= 0) {
      return {
        status: "no-activity",
        percentChange: null,
        currentTotal,
        previousTotal: null,
        isEstimate,
        direction: "none",
        label: "No earnings logged yet",
      };
    }
    return {
      status: "no-prior-data",
      percentChange: null,
      currentTotal,
      previousTotal: null,
      isEstimate,
      direction: "none",
      label: "No prior-week data",
    };
  }

  const previousTotal = round2(previous.earnings);

  if (currentTotal <= 0 && previousTotal <= 0) {
    return {
      status: "no-activity",
      percentChange: null,
      currentTotal,
      previousTotal,
      isEstimate,
      direction: "none",
      label: "No earnings either week",
    };
  }

  // Prior week logged something but earned nothing. A percentage would be a
  // division by zero; "New this week" is both true and useful.
  if (previousTotal <= 0) {
    return {
      status: "new-this-week",
      percentChange: null,
      currentTotal,
      previousTotal,
      isEstimate,
      direction: "up",
      label: "New this week",
    };
  }

  const rawPercent = ((currentTotal - previousTotal) / previousTotal) * 100;
  const percentChange = Math.round(rawPercent);

  if (currentTotal === previousTotal) {
    return {
      status: "no-change",
      percentChange: 0,
      currentTotal,
      previousTotal,
      isEstimate,
      direction: "none",
      label: "No change vs prior week",
    };
  }

  // A real difference that rounds to zero. Showing "▲ 0%" here is exactly the
  // bug this module exists to remove, so it gets its own wording.
  if (percentChange === 0) {
    return {
      status: "negligible",
      percentChange: 0,
      currentTotal,
      previousTotal,
      isEstimate,
      direction: "none",
      label: "About the same as prior week",
    };
  }

  const up = percentChange > 0;
  return {
    status: up ? "up" : "down",
    percentChange,
    currentTotal,
    previousTotal,
    isEstimate,
    direction: up ? "up" : "down",
    label: `${Math.abs(percentChange)}% vs prior week`,
  };
}
