import { describe, expect, it } from "vitest";
import type { DayComputed, WeekSummary } from "../aggregate";
import type { SpendingSummary } from "../types";
import {
  isDateInRange,
  withLiveDay,
  withLiveInProgressPeriod,
  withLiveSpendingEarnings,
} from "../liveShiftVisuals";

const day: DayComputed = {
  dateISO: "2026-08-29",
  dayAbbr: "Sat",
  dateLabel: "Aug 29",
  isToday: true,
  shifts: [],
  hours: 2,
  hoursLabel: "2.00h",
  moneyLabel: "$75.00",
  fuelCost: 15,
  fuelCostLabel: "$15.00",
};

const summary: SpendingSummary = {
  period: { from: "2026-08-01", to: "2026-08-31", previousFrom: "2026-07-01", previousTo: "2026-07-31", days: 31 },
  earningsCents: 100_000,
  earningsRecorded: true,
  totalSpendingCents: 25_000,
  differenceCents: 75_000,
  spendingPercentage: 25,
  averageDailyCents: 806,
  transactionCount: 0,
  largestCategory: null,
  previous: { earningsCents: 0, totalSpendingCents: 0, spendingChangePercent: null },
  categories: [],
  trend: [],
  recentExpenses: [],
};

describe("live shift visual models", () => {
  it("adds elapsed hours and earnings to only the active day without mutating settled data", () => {
    const other = { ...day, dateISO: "2026-08-28", dayAbbr: "Fri", isToday: false };
    const result = withLiveDay([other, day], day.dateISO, 1.5, 30, "$");

    expect(result[0]).toBe(other);
    expect(result[1]).toMatchObject({ hours: 3.5, hoursLabel: "3.50h", moneyLabel: "$120.00" });
    expect(day.hours).toBe(2);
  });

  it("adds elapsed time only to the in-progress comparison period", () => {
    const periods: WeekSummary[] = [
      { startISO: "2026-07-01", endISO: "2026-07-31", label: "July", short: "Jul", hours: 10, earnings: 300 },
      { startISO: "2026-08-01", endISO: "2026-08-31", label: "August", short: "Aug", hours: 20, earnings: 600, inProgress: true },
    ];
    const result = withLiveInProgressPeriod(periods, 0.5, 30);

    expect(result[0]).toBe(periods[0]);
    expect(result[1]).toMatchObject({ hours: 20.5, earnings: 615 });
  });

  it("updates earnings comparisons while leaving expense data unchanged", () => {
    const result = withLiveSpendingEarnings(summary, 1.25, 30);

    expect(result.earningsCents).toBe(103_750);
    expect(result.differenceCents).toBe(78_750);
    expect(result.spendingPercentage).toBeCloseTo(24.0964, 4);
    expect(result.totalSpendingCents).toBe(summary.totalSpendingCents);
    expect(summary.earningsCents).toBe(100_000);
  });

  it("checks the active shift date against inclusive reporting boundaries", () => {
    expect(isDateInRange("2026-08-01", "2026-08-01", "2026-08-31")).toBe(true);
    expect(isDateInRange("2026-08-31", "2026-08-01", "2026-08-31")).toBe(true);
    expect(isDateInRange("2026-09-01", "2026-08-01", "2026-08-31")).toBe(false);
    expect(isDateInRange(null, "2026-08-01", "2026-08-31")).toBe(false);
  });
});
