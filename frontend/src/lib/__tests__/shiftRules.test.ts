import { afterEach, describe, expect, it, vi } from "vitest";
import { describeShiftTimes, isUnusuallyLongShift, LONG_SHIFT_WARNING } from "../shiftRules";
import { isoDate } from "../date";

afterEach(() => vi.useRealTimers());

describe("frontend shift date validation", () => {
  it("accepts today and rejects tomorrow immediately in the browser's local calendar", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 13, 23, 30));
    expect(describeShiftTimes("2026-08-13", "09:00", "17:00")).toBeNull();
    expect(describeShiftTimes("2026-08-14", "09:00", "17:00")).toMatch(/future date/i);
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
  it("flags 08:50 to 01:30 as unusual without making it a validation error", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 13, 12, 0));
    expect(isUnusuallyLongShift("08:50", "01:30")).toBe(true);
    expect(LONG_SHIFT_WARNING).toMatch(/confirm/i);
    expect(describeShiftTimes("2026-08-13", "08:50", "01:30")).toBeNull();
  });

  it("does not warn for a normal overnight shift", () => {
    expect(isUnusuallyLongShift("22:00", "06:00")).toBe(false);
  });
});
