import { describe, expect, it } from "vitest";
import type { WeekSummary } from "../../lib/aggregate";
import {
  currentMonthRange,
  formatHistoryDateRange,
  previousMonthRange,
  recentThreeMonthsRange,
  weekOverlapsRange,
} from "../historyDateRange";

const WEEK: WeekSummary = {
  startISO: "2026-08-31",
  endISO: "2026-09-06",
  label: "Aug 31 – Sep 6",
  short: "Aug 31",
  hours: 40,
  earnings: 1200,
};

describe("History report date ranges", () => {
  const today = new Date(2026, 8, 16, 10, 0, 0);

  it("builds calendar-month presets from the app's local today", () => {
    expect(currentMonthRange(today)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousMonthRange(today)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(recentThreeMonthsRange(today)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
  });

  it("includes a weekly PDF when any part of its week overlaps the selected range", () => {
    expect(weekOverlapsRange(WEEK, { from: "2026-09-01", to: "2026-09-30" })).toBe(true);
    expect(weekOverlapsRange(WEEK, { from: "2026-08-01", to: "2026-08-31" })).toBe(true);
    expect(weekOverlapsRange(WEEK, { from: "2026-09-07", to: "2026-09-30" })).toBe(false);
  });

  it("formats month, same-month, cross-month, and cross-year labels clearly", () => {
    expect(formatHistoryDateRange({ from: "2026-09-01", to: "2026-09-30" })).toBe("September 2026");
    expect(formatHistoryDateRange({ from: "2026-09-03", to: "2026-09-15" })).toBe("Sep 3–15, 2026");
    expect(formatHistoryDateRange({ from: "2026-08-24", to: "2026-09-13" })).toBe("Aug 24 – Sep 13, 2026");
    expect(formatHistoryDateRange({ from: "2025-12-29", to: "2026-01-04" })).toBe("Dec 29, 2025 – Jan 4, 2026");
  });
});
