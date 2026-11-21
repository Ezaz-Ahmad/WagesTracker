import { describe, expect, it } from "vitest";
import { completedShiftWageCents } from "../src/earnings.js";
const cases = [
  [1850, 108, 56],
  [2850, 492, 390],
  [3030, 3900, 3283],
  [3003, 33000, 27528],
  [3100, 270, 233],
  [3210, 1140, 1017],
  [3455, 1080, 1037],
  [3850, 756, 809],
];
describe("integer-second wage rounding", () => {
  it.each(cases)(
    "rounds rate %i cents × %i seconds to %i cents",
    (rate, seconds, expected) => {
      const end = [
        Math.floor(seconds / 3600),
        Math.floor((seconds % 3600) / 60),
        seconds % 60,
      ]
        .map((part) => String(part).padStart(2, "0"))
        .join(":");
      expect(completedShiftWageCents("00:00:00", end, rate)).toBe(expected);
    }
  );
});
