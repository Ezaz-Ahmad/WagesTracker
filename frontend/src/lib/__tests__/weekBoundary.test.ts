import { describe, expect, it } from "vitest";
import { buildWeekDays, isoDate, startOfWeek } from "../date";
import {
  WEEK_DAYS,
  addIsoDays,
  startOfWeekISO,
  weekEndDay,
  weekRangeISO,
} from "../weekBoundary.mjs";

describe("canonical seven-day week boundaries", () => {
  it.each([
    ["Monday", "2026-08-17", "2026-08-23", "Sunday"],
    ["Tuesday", "2026-08-18", "2026-08-24", "Monday"],
    ["Wednesday", "2026-08-19", "2026-08-25", "Tuesday"],
    ["Thursday", "2026-08-13", "2026-08-19", "Wednesday"],
    ["Friday", "2026-08-14", "2026-08-20", "Thursday"],
    ["Saturday", "2026-08-15", "2026-08-21", "Friday"],
    ["Sunday", "2026-08-16", "2026-08-22", "Saturday"],
  ] as const)("maps a Wednesday into a %s–%s cycle", (day, start, end, closingDay) => {
    expect(weekRangeISO("2026-08-19", day)).toEqual({ start, end });
    expect(weekEndDay(day)).toBe(closingDay);

    const browserStart = startOfWeek(new Date(2026, 7, 19), day);
    expect(isoDate(browserStart)).toBe(start);
    expect(buildWeekDays(new Date(2026, 7, 19), day).map(isoDate)).toEqual(
      Array.from({ length: 7 }, (_, index) => addIsoDays(start, index))
    );
  });

  it("crosses a month boundary without losing or duplicating a date", () => {
    expect(weekRangeISO("2026-03-01", "Tuesday")).toEqual({
      start: "2026-02-24",
      end: "2026-03-02",
    });
  });

  it("crosses a year boundary", () => {
    expect(weekRangeISO("2026-01-01", "Friday")).toEqual({
      start: "2025-12-26",
      end: "2026-01-01",
    });
  });

  it("handles leap day with plain-calendar arithmetic", () => {
    expect(weekRangeISO("2024-02-29", "Tuesday")).toEqual({
      start: "2024-02-27",
      end: "2024-03-04",
    });
    expect(addIsoDays("2024-02-28", 1)).toBe("2024-02-29");
  });

  it("closes Monday and starts a new cycle when Tuesday arrives", () => {
    expect(weekRangeISO("2026-08-24", "Tuesday")).toEqual({
      start: "2026-08-18",
      end: "2026-08-24",
    });
    expect(weekRangeISO("2026-08-25", "Tuesday")).toEqual({
      start: "2026-08-25",
      end: "2026-08-31",
    });
  });

  it("rejects impossible calendar dates instead of normalising them", () => {
    expect(() => startOfWeekISO("2026-02-30", "Monday")).toThrow(RangeError);
  });

  it("contains exactly the seven supported preference values", () => {
    expect(WEEK_DAYS).toEqual([
      "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    ]);
  });
});
