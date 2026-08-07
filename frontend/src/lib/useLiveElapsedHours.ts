import { useEffect, useState } from "react";

/**
 * The actual math behind `useLiveElapsedHours`, pulled out as a plain
 * function so it's unit-testable without rendering a component (this repo's
 * test setup deliberately stays out of jsdom/React-rendering territory —
 * see vitest.config.ts). `now` defaults to the real current time; tests pass
 * a fixed `Date` so the result is deterministic.
 *
 * Clamped to never go below 0 — if `signInHHMM`'s time-of-day is later than
 * `now`'s (e.g. a sign-in of 23:00 with `now` at 01:00), that's the same
 * "unsupported" shape as an overnight shift (see computeHours in date.ts):
 * this never guesses it means "yesterday", it just reads as not-yet-started.
 */
export function computeElapsedHours(signInHHMM: string, now: Date = new Date()): number {
  const [h, m, s = 0] = signInHHMM.split(":").map(Number);
  const start = new Date(now);
  start.setHours(h, m, s, 0);
  return Math.max(0, (now.getTime() - start.getTime()) / 3_600_000);
}

/**
 * Live elapsed hours since `signInHHMM`, ticking every second while `active`.
 * Returns 0 when there's no open shift. Add this to the week's already-saved
 * totals to show earnings/hours climbing in real time during a shift, instead
 * of jumping only once the shift is signed out and persisted.
 */
export function useLiveElapsedHours(active: boolean, signInHHMM: string | null): number {
  const [, tick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);

  if (!active || !signInHHMM) return 0;
  return computeElapsedHours(signInHHMM);
}
