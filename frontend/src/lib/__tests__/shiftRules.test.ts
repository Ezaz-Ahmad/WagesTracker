import { afterEach, describe, expect, it, vi } from "vitest";
import { describeShiftTimes, isElapsedShiftOver24Hours, isUnusuallyLongShift, LONG_SHIFT_WARNING } from "../shiftRules";
import { isoDate } from "../date";

afterEach(() => vi.useRealTimers());

describe("frontend shift date validation", () => {
  it("accepts today and rejects tomorrow immediately in the browser's local calendar", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 13, 23, 30));
    expect(describeShiftTimes("2026-08-13", "09:00", "17:00")).toBeNull();
    expect(describeShiftTimes("2026-08-14", "09:00", "17:00")).toMatch(/future date/i);
    expect(describeShiftTimes("2026-08-14", "09:00", "17:00", true)).toBeNull();
  });

  it("keeps an overnight shift beginning today valid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 13, 23, 30));
    expect(describeShiftTimes("2026-08-13", "22:00", "06:00")).toBeNull();
  });

  it("uses the local calendar date at a local midnight boundary", () => {
    vi.useFakeTimers();
    const justAfterLocalMidnight = new Date(2026, 9, 4, 0, 5);
    vi.setSystemTime(justAfterLocalMidnight);
    expect(isoDate(new Date())).toBe("2026-10-04");
    expect(describeShiftTimes("2026-10-04", "09:00", "17:00")).toBeNull();
    expect(describeShiftTimes("2026-10-05", "09:00", "17:00")).toMatch(/future date/i);
  });

  it("continues rejecting zero-length shifts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 13, 12, 0));
    expect(describeShiftTimes("2026-08-13", "09:00", "09:00")).toMatch(/same time/i);
  });
});

describe("long-shift warning", () => {
  it("does not flag a normal overnight shift under 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 13, 12, 0));
    expect(isUnusuallyLongShift("08:50", "01:30")).toBe(false);
    expect(LONG_SHIFT_WARNING).toMatch(/confirm/i);
    expect(describeShiftTimes("2026-08-13", "08:50", "01:30")).toBeNull();
  });

  it("does not warn for a normal overnight shift", () => {
    expect(isUnusuallyLongShift("22:00", "06:00")).toBe(false);
  });

  it("detects a live shift that has actually crossed 24 hours", () => {
    expect(isElapsedShiftOver24Hours("2026-08-08", "00:00", new Date(2026, 7, 9, 0, 1))).toBe(true);
    expect(isElapsedShiftOver24Hours("2026-08-08", "00:00", new Date(2026, 7, 8, 23, 59))).toBe(false);
  });
});
