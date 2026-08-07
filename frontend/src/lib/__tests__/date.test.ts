import { describe, expect, it } from "vitest";
import { computeElapsedHours } from "../useLiveElapsedHours";
import { computeHours } from "../date";

// Table-driven per the app's confirmed intended behavior: overnight shifts
// (sign-out earlier than sign-in) are supported and read as crossing
// midnight into the next calendar day — only an identical sign-in/sign-out
// is actually invalid (zero-length).
describe("computeHours", () => {
  it("6:00 PM – 10:00 PM = 4 hours (same-day, no wrap)", () => {
    expect(computeHours("18:00", "22:00")).toBe(4);
  });

  it("10:00 PM – 6:00 AM = 8 hours (crosses midnight)", () => {
    expect(computeHours("22:00", "06:00")).toBe(8);
  });

  it("2:30 PM – 1:20 AM = 10 hours 50 minutes (crosses midnight)", () => {
    expect(computeHours("14:30", "01:20")).toBeCloseTo(10 + 50 / 60, 6);
  });

  it("11:59 PM – 12:01 AM = 2 minutes (short overnight shift)", () => {
    expect(computeHours("23:59", "00:01")).toBeCloseTo(2 / 60, 6);
  });

  it("6:00 PM – 6:00 PM = zero-length/invalid → 0 hours", () => {
    expect(computeHours("18:00", "18:00")).toBe(0);
  });

  it("returns 0 when either time is missing", () => {
    expect(computeHours(null, "17:00")).toBe(0);
    expect(computeHours("09:00", null)).toBe(0);
    expect(computeHours(null, null)).toBe(0);
  });

  it("keeps second-level precision for short shifts (HH:MM:SS input)", () => {
    // 30 seconds = 30/3600 hour — precise enough that a short sign-in/out
    // still counts for something instead of rounding away to 0.
    expect(computeHours("09:00:00", "09:00:30")).toBeCloseTo(30 / 3600, 6);
  });

  it("an overnight shift's hours belong entirely to its starting date, not split across two days", () => {
    // computeHours itself is date-agnostic (it only ever sees two times),
    // which is exactly the point: there's nowhere in this calculation for
    // an end date to even enter. Whichever single `date` a shift is filed
    // under (see backend/src/routes/shifts.ts and Shift in lib/types.ts)
    // gets 100% of the duration — see aggregate.test.ts for the same rule
    // proven at the day-grouping level.
    expect(computeHours("22:00", "06:00")).toBe(8);
  });
});

describe("computeElapsedHours (active/in-progress shift)", () => {
  it("returns a sensible positive value for a same-day shift signed in earlier today", () => {
    const now = new Date(2026, 0, 5, 11, 30, 0); // 11:30am
    const hours = computeElapsedHours("09:30", now); // signed in at 9:30am
    expect(hours).toBeCloseTo(2, 6);
    expect(Number.isNaN(hours)).toBe(false);
  });

  it("is 0, not negative, right at the moment of signing in", () => {
    const now = new Date(2026, 0, 5, 9, 30, 0);
    expect(computeElapsedHours("09:30", now)).toBe(0);
  });

  it("correctly counts elapsed hours for a still-active overnight shift by rolling sign-in back a day", () => {
    // Signed in at 11:00 PM; it's now 1:00 AM — two hours into an overnight
    // shift that hasn't been signed out yet. This must read as 2 hours
    // elapsed, not 0 (which is what a naive same-day-only calculation would
    // produce, since 23:00 is "later" than 01:00 on the clock alone).
    const now = new Date(2026, 0, 6, 1, 0, 0);
    const hours = computeElapsedHours("23:00", now);
    expect(Number.isNaN(hours)).toBe(false);
    expect(hours).toBeCloseTo(2, 6);
  });

  it("never produces NaN or a negative value across same-day and overnight cases", () => {
    const cases: [string, Date][] = [
      ["09:00", new Date(2026, 0, 5, 9, 0, 0)],
      ["09:00", new Date(2026, 0, 5, 17, 0, 0)],
      ["23:30", new Date(2026, 0, 6, 0, 15, 0)],
    ];
    for (const [signIn, now] of cases) {
      const hours = computeElapsedHours(signIn, now);
      expect(Number.isNaN(hours)).toBe(false);
      expect(hours).toBeGreaterThanOrEqual(0);
    }
  });
});
