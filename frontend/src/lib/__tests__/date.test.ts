import { describe, expect, it } from "vitest";
import { computeHours } from "../date";

describe("computeHours", () => {
  it("computes a normal same-day shift", () => {
    expect(computeHours("09:00", "17:00")).toBe(8);
  });

  it("computes an overnight shift that crosses midnight", () => {
    // Sign in at 10pm, out at 6am the next morning — the raw HH:MM diff goes
    // negative, which computeHours has to detect and wrap by adding 24h.
    expect(computeHours("22:00", "06:00")).toBe(8);
  });

  it("computes a short overnight shift correctly", () => {
    expect(computeHours("23:30", "00:15")).toBeCloseTo(0.75, 6);
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
