import { describe, expect, it } from "vitest";
import { computeElapsedHours } from "../useLiveElapsedHours";
import { computeHours } from "../date";

describe("computeHours", () => {
  it("computes a normal same-day shift", () => {
    expect(computeHours("09:00", "17:00")).toBe(8);
  });

  it("treats a sign-out earlier than sign-in as unsupported (overnight shifts aren't allowed) and returns 0", () => {
    // Sign in at 10pm, "out" at 6am the next morning — the backend rejects
    // this at creation (see backend/src/routes/shifts.ts), so this is really
    // just guarding against stale/pre-existing data: no wrap-to-next-day
    // guessing, just the same fallback as a shift with no sign-out yet.
    expect(computeHours("22:00", "06:00")).toBe(0);
  });

  it("returns 0 when either time is missing", () => {
    expect(computeHours(null, "17:00")).toBe(0);
    expect(computeHours("09:00", null)).toBe(0);
    expect(computeHours(null, null)).toBe(0);
  });

  it("returns 0 for a zero-length shift (sign-in equals sign-out)", () => {
    expect(computeHours("09:00", "09:00")).toBe(0);
  });

  it("keeps second-level precision for short shifts (HH:MM:SS input)", () => {
    // 30 seconds = 30/3600 hour — precise enough that a short sign-in/out
    // still counts for something instead of rounding away to 0.
    expect(computeHours("09:00:00", "09:00:30")).toBeCloseTo(30 / 3600, 6);
  });
});

describe("computeElapsedHours (active/in-progress shift)", () => {
  it("returns a sensible positive value for a shift signed in earlier today", () => {
    const now = new Date(2026, 0, 5, 11, 30, 0); // 11:30am
    const hours = computeElapsedHours("09:30", now); // signed in at 9:30am
    expect(hours).toBeCloseTo(2, 6);
    expect(Number.isNaN(hours)).toBe(false);
    expect(hours).toBeGreaterThanOrEqual(0);
  });

  it("is 0, not negative, right at the moment of signing in", () => {
    const now = new Date(2026, 0, 5, 9, 30, 0);
    expect(computeElapsedHours("09:30", now)).toBe(0);
  });

  it("never goes negative for a sign-in time that's later than 'now' on the clock", () => {
    // Guards the same "overnight" edge case as computeHours: a signIn of
    // 23:00 with 'now' at 01:00 the same calendar day (as far as this
    // function's concerned — it only ever compares times, not dates) must
    // not read as a negative elapsed duration.
    const now = new Date(2026, 0, 5, 1, 0, 0);
    const hours = computeElapsedHours("23:00", now);
    expect(Number.isNaN(hours)).toBe(false);
    expect(hours).toBe(0);
  });
});
