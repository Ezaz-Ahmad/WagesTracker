import { computeHours } from "./date";
import type { Job, PayRate, Shift } from "./types";
import type { WeekExtra, WeekStart } from "./types";
import { addIsoDays, startOfWeekISO } from "./weekBoundary.mjs";

/** Currency is rounded once per completed shift; every total sums those cents. */
export function wagesForHours(hours: number, rate: number): number {
  const seconds = Math.round(hours * 3600);
  return Math.round((seconds * Math.round(rate * 100)) / 3600) / 100;
}
export function shiftWages(
  shift: Pick<Shift, "signIn" | "signOut" | "appliedRate">,
  fallbackRate: number
): number {
  return wagesForHours(
    computeHours(shift.signIn, shift.signOut),
    shift.appliedRate ?? fallbackRate
  );
}
export function sumShiftWages(shifts: Shift[], fallbackRate: number): number {
  return (
    shifts.reduce(
      (sum, shift) => sum + Math.round(shiftWages(shift, fallbackRate) * 100),
      0
    ) / 100
  );
}
export function alignExtrasToWeek(
  extras: WeekExtra[],
  weekStart: WeekStart
): WeekExtra[] {
  return extras.map((e) => ({
    ...e,
    weekStart: startOfWeekISO(
      e.effectiveDate || addIsoDays(e.weekStart, 6),
      weekStart
    ),
  }));
}
export function resolveShiftRate(
  job: Job,
  rates: PayRate[],
  locationId: string | null,
  date: string
): { rate: number; source: "job" | "location"; effectiveFrom: string } {
  const latest = (location: string | null) =>
    rates
      .filter(
        (r) =>
          r.jobId === job.id &&
          r.locationId === location &&
          r.effectiveFrom <= date
      )
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
  const local = locationId ? latest(locationId) : undefined;
  if (local?.rate != null)
    return {
      rate: local.rate,
      source: "location",
      effectiveFrom: local.effectiveFrom,
    };
  const base = latest(null);
  return {
    rate: base?.rate ?? job.rate,
    source: "job",
    effectiveFrom: base?.effectiveFrom ?? job.createdAt.slice(0, 10),
  };
}
