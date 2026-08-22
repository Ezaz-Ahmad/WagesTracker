import { useLiveNow } from "./liveClock";

/**
 * The actual math behind `useLiveElapsedHours`, pulled out as a plain
 * function so it's unit-testable without rendering a component (this repo's
 * test setup deliberately stays out of jsdom/React-rendering territory —
 * see vitest.config.ts). `now` defaults to the real current time; tests pass
 * a fixed `Date` so the result is deterministic.
 *
 * Handles a still-active *overnight* shift correctly, matching computeHours
 * in date.ts: if `signInHHMM`'s time-of-day is later than `now`'s (e.g. a
 * sign-in of 23:00 with `now` at 01:00), that means midnight has already
 * passed since sign-in — the shift started *yesterday*, not later today — so
 * `start` rolls back one calendar day rather than landing in the future.
 * Without that adjustment this would compute a negative duration for
 * exactly the case someone most wants to see their live timer keep counting:
 * a night shift that's still going.
 */
export function computeElapsedHours(signInHHMM: string, now: Date = new Date()): number {
  const [h, m, s = 0] = signInHHMM.split(":").map(Number);
  const start = new Date(now);
  start.setHours(h, m, s, 0);
  if (start.getTime() > now.getTime()) {
    start.setDate(start.getDate() - 1);
  }
  return Math.max(0, (now.getTime() - start.getTime()) / 3_600_000);
}

/**
 * Live elapsed hours since `signInHHMM`, ticking every second while `active`.
 * Returns 0 when there's no open shift. Add this to the week's already-saved
 * totals to show earnings/hours climbing in real time during a shift, instead
 * of jumping only once the shift is signed out and persisted.
 */
export function useLiveElapsedHours(active: boolean, signInHHMM: string | null): number {
  const nowMs = useLiveNow(active && !!signInHHMM);
  if (!active || !signInHHMM) return 0;
  return computeElapsedHours(signInHHMM, new Date(nowMs));
}
