import { formatElapsed } from "./date";
import { useLiveElapsedHours } from "./useLiveElapsedHours";

/**
 * The on-screen HH:MM:SS shift clock. Reuses `computeElapsedHours` (the
 * same overnight-safe math `useLiveElapsedHours` uses for the numeric
 * hours added to weekly totals) instead of its own date arithmetic — the
 * previous version built its "start" moment from *today's* date, so once
 * midnight passed on an overnight shift, `start` landed later than `now`
 * and produced a negative duration, which `formatElapsed`'s clamp to 0
 * turned into a frozen "00:00:00" instead of a running clock. Sharing one
 * calculation means the visible timer and the hours actually added to
 * totals can never disagree with each other.
 */
export function useShiftTimer(active: boolean, signInHHMM: string | null): string {
  const elapsedHours = useLiveElapsedHours(active, signInHHMM);
  if (!active || !signInHHMM) return "00:00:00";
  return formatElapsed(elapsedHours * 3_600_000);
}
