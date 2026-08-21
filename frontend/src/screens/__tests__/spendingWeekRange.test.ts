import { describe, expect, it } from "vitest";
import { spendingRangeFor } from "../SpendingScreen";
import { WEEK_DAYS } from "../../lib/weekBoundary.mjs";

describe("Spending 'This week' range", () => {
  it.each([
    ["Monday", "2026-08-17", "2026-08-23"],
    ["Tuesday", "2026-08-18", "2026-08-24"],
    ["Wednesday", "2026-08-19", "2026-08-25"],
    ["Thursday", "2026-08-13", "2026-08-19"],
    ["Friday", "2026-08-14", "2026-08-20"],
    ["Saturday", "2026-08-15", "2026-08-21"],
    ["Sunday", "2026-08-16", "2026-08-22"],
  ] as const)("uses the configured %s boundary", (day, from, to) => {
    expect(spendingRangeFor("week", new Date(2026, 7, 19), day, "", "")).toEqual({ from, to });
  });

  it("covers the same complete set of days as the profile preference", () => {
    expect(WEEK_DAYS).toHaveLength(7);
  });
});
