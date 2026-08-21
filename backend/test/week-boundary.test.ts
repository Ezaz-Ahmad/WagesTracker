import { describe, expect, it } from "vitest";
import { WEEK_DAYS, weekRangeISO } from "../src/weekBoundary.js";

describe("API/frontend week-boundary contract", () => {
  it.each([
    ["Monday", "2026-08-17", "2026-08-23"],
    ["Tuesday", "2026-08-18", "2026-08-24"],
    ["Wednesday", "2026-08-19", "2026-08-25"],
    ["Thursday", "2026-08-13", "2026-08-19"],
    ["Friday", "2026-08-14", "2026-08-20"],
    ["Saturday", "2026-08-15", "2026-08-21"],
    ["Sunday", "2026-08-16", "2026-08-22"],
  ] as const)("uses the shared frontend/API implementation for %s", (day, start, end) => {
    expect(weekRangeISO("2026-08-19", day)).toEqual({ start, end });
  });

  it("exports the complete preference contract to the API", () => {
    expect(WEEK_DAYS).toHaveLength(7);
  });
});
