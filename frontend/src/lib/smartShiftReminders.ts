import type { Shift } from "./types";

export const SMART_REMINDER_MIN_SHIFTS = 4;
export const SMART_REMINDER_LOOKBACK_WEEKS = 8;
export const SMART_REMINDER_START_GRACE_MINUTES = 20;
export const SMART_REMINDER_END_GRACE_MINUTES = 20;

const MAX_SAMPLES = 12;
const MIN_ATTENDANCE_RATIO = 0.7;
const MIN_INLIER_RATIO = 0.75;
const START_TOLERANCE_MINUTES = 45;
const END_TOLERANCE_MINUTES = 60;
const MAX_START_SPREAD_MINUTES = 60;
const MAX_END_SPREAD_MINUTES = 90;
const MIN_SHIFT_MINUTES = 60;
const MAX_SHIFT_MINUTES = 16 * 60;
export const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
] as const;

export interface SmartShiftPattern {
  weekday: number;
  weekdayName: typeof WEEKDAY_NAMES[number];
  sampleSize: number;
  usualStartMinutes: number;
  /** Minutes after midnight on the shift's starting date; over 1440 means
   * the usual finish is after midnight on the following date. */
  usualEndOffsetMinutes: number;
  startSpreadMinutes: number;
  endSpreadMinutes: number;
}

export type SmartReminderKind = "signIn" | "signOut";

export interface SmartReminderScheduleItem {
  id: string;
  kind: SmartReminderKind;
  fireAtEpochMs: number;
  title: string;
  body: string;
  weekdayName: string;
  usualTimeLabel: string;
  shiftId?: string;
}

interface Sample {
  date: string;
  start: number;
  endOffset: number;
}

function parseMinutes(value: string): number | null {
  const parts = value.split(":").map(Number);
  if (parts.length < 2 || parts.some(Number.isNaN)) return null;
  const [hours, minutes, seconds = 0] = parts;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) return null;
  return hours * 60 + minutes + seconds / 60;
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function roundedFiveMinutes(value: number): number {
  return Math.round(value / 5) * 5;
}

function weekdayForDate(date: string): number | null {
  return parseLocalDate(date)?.getDay() ?? null;
}

/**
 * Learns conservative weekday routines from live-captured, completed shifts.
 * A weekday is returned only when all of these are true:
 * - at least four usable single-shift days exist;
 * - the user worked that weekday on at least 70% of its observed recent
 *   occurrences (so alternating/occasional work is not treated as weekly);
 * - at least 75% of usable samples agree within the start/end tolerances;
 * - the remaining cluster is tight enough to be useful.
 *
 * Manual/corrected rows (`reminderEligible === false`), split-shift days,
 * implausibly short/long durations and robust statistical outliers never
 * influence the learned time.
 */
export function analyseSmartShiftPatterns(
  shifts: readonly Shift[],
  asOf: Date = new Date()
): SmartShiftPattern[] {
  const today = startOfLocalDay(asOf);
  const todayKey = localDateKey(today);
  const completeByDate = new Map<string, Shift[]>();

  for (const shift of shifts) {
    if (!shift.signIn || !shift.signOut || shift.date >= todayKey) continue;
    const list = completeByDate.get(shift.date) ?? [];
    list.push(shift);
    completeByDate.set(shift.date, list);
  }

  const patterns: SmartShiftPattern[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const workedDates = [...completeByDate.keys()]
      .filter((date) => weekdayForDate(date) === weekday)
      .sort();
    if (workedDates.length < SMART_REMINDER_MIN_SHIFTS) continue;

    const firstWorked = parseLocalDate(workedDates[0]);
    if (!firstWorked) continue;
    const observationFloor = addLocalDays(today, -SMART_REMINDER_LOOKBACK_WEEKS * 7);
    const observationStart = firstWorked > observationFloor ? firstWorked : observationFloor;
    let observedOccurrences = 0;
    for (let cursor = addLocalDays(today, -1); cursor >= observationStart; cursor = addLocalDays(cursor, -1)) {
      if (cursor.getDay() === weekday) observedOccurrences += 1;
    }
    if (observedOccurrences < SMART_REMINDER_MIN_SHIFTS) continue;

    const recentWorkedDates = workedDates.filter((date) => {
      const parsed = parseLocalDate(date);
      return !!parsed && parsed >= observationStart;
    });
    if (recentWorkedDates.length / observedOccurrences < MIN_ATTENDANCE_RATIO) continue;

    const samples: Sample[] = [];
    for (const date of recentWorkedDates.slice(-MAX_SAMPLES)) {
      const rows = completeByDate.get(date) ?? [];
      // A day with multiple shifts is a split/atypical workday; guessing
      // which start/end represents the person's routine would be intrusive.
      if (rows.length !== 1) continue;
      const shift = rows[0];
      if (shift.reminderEligible === false) continue;
      const start = parseMinutes(shift.signIn!);
      const rawEnd = parseMinutes(shift.signOut!);
      if (start === null || rawEnd === null) continue;
      const endOffset = rawEnd <= start ? rawEnd + 24 * 60 : rawEnd;
      const duration = endOffset - start;
      if (duration < MIN_SHIFT_MINUTES || duration > MAX_SHIFT_MINUTES) continue;
      samples.push({ date, start, endOffset });
    }
    if (samples.length < SMART_REMINDER_MIN_SHIFTS) continue;

    const initialStart = median(samples.map((sample) => sample.start));
    const initialEnd = median(samples.map((sample) => sample.endOffset));
    const inliers = samples.filter((sample) =>
      Math.abs(sample.start - initialStart) <= START_TOLERANCE_MINUTES
      && Math.abs(sample.endOffset - initialEnd) <= END_TOLERANCE_MINUTES
    );
    if (
      inliers.length < SMART_REMINDER_MIN_SHIFTS
      || inliers.length / samples.length < MIN_INLIER_RATIO
    ) continue;

    const starts = inliers.map((sample) => sample.start);
    const ends = inliers.map((sample) => sample.endOffset);
    const startSpread = Math.max(...starts) - Math.min(...starts);
    const endSpread = Math.max(...ends) - Math.min(...ends);
    if (startSpread > MAX_START_SPREAD_MINUTES || endSpread > MAX_END_SPREAD_MINUTES) continue;

    patterns.push({
      weekday,
      weekdayName: WEEKDAY_NAMES[weekday],
      sampleSize: inliers.length,
      usualStartMinutes: roundedFiveMinutes(median(starts)),
      usualEndOffsetMinutes: roundedFiveMinutes(median(ends)),
      startSpreadMinutes: Math.round(startSpread),
      endSpreadMinutes: Math.round(endSpread),
    });
  }
  return patterns;
}

export function formatReminderTime(minutes: number): string {
  const normalized = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function atMinutesOnDate(date: Date, minutes: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, minutes, 0, 0);
}

/** Produces one-shot native notifications. Nothing repeats weekly: the next
 * seven local calendar days are reconsidered whenever fresh data is loaded,
 * and today's item is removed as soon as a shift starts. */
export function buildSmartReminderSchedule(options: {
  accountId: string;
  firstName: string;
  shifts: readonly Shift[];
  patterns: readonly SmartShiftPattern[];
  now?: Date;
}): SmartReminderScheduleItem[] {
  const now = options.now ?? new Date();
  const today = startOfLocalDay(now);
  const schedule: SmartReminderScheduleItem[] = [];
  const firstName = options.firstName.trim() || "there";

  for (let offset = 0; offset < 7; offset += 1) {
    const date = addLocalDays(today, offset);
    const dateKey = localDateKey(date);
    const pattern = options.patterns.find((item) => item.weekday === date.getDay());
    if (!pattern) continue;
    if (options.shifts.some((shift) => shift.date === dateKey && !!shift.signIn)) continue;

    const fireAt = atMinutesOnDate(
      date,
      pattern.usualStartMinutes + SMART_REMINDER_START_GRACE_MINUTES
    );
    if (fireAt.getTime() <= now.getTime() + 30_000) continue;
    const usualTimeLabel = formatReminderTime(pattern.usualStartMinutes);
    schedule.push({
      id: `signin-${dateKey}`,
      kind: "signIn",
      fireAtEpochMs: fireAt.getTime(),
      title: "Shift check-in",
      body: `Hi ${firstName}, you usually start your ${pattern.weekdayName} shift around ${usualTimeLabel}, but no shift has been started today. Did you forget to sign in?`,
      weekdayName: pattern.weekdayName,
      usualTimeLabel,
    });
  }

  const openShift = [...options.shifts].reverse().find((shift) => !!shift.signIn && !shift.signOut);
  if (openShift?.signIn) {
    const shiftDate = parseLocalDate(openShift.date);
    const pattern = shiftDate && options.patterns.find((item) => item.weekday === shiftDate.getDay());
    const openStartMinutes = parseMinutes(openShift.signIn);
    // A genuinely unusual start today is weak evidence for the usual finish
    // (for example, covering a late shift on an otherwise regular Monday).
    // Stay quiet instead of applying the normal daytime pattern to it.
    const followsUsualStart = openStartMinutes !== null
      && Math.abs(openStartMinutes - (pattern?.usualStartMinutes ?? openStartMinutes)) <= 90;
    if (shiftDate && pattern && followsUsualStart) {
      let fireAt = atMinutesOnDate(
        shiftDate,
        pattern.usualEndOffsetMinutes + SMART_REMINDER_END_GRACE_MINUTES
      );
      // If the app discovers an active shift shortly after its usual finish,
      // a one-minute delay remains useful. Much later than that is ambiguous
      // (overtime/overnight work), so stay quiet rather than nagging.
      const lateness = now.getTime() - fireAt.getTime();
      if (lateness > 0 && lateness <= 4 * 60 * 60 * 1000) {
        fireAt = new Date(now.getTime() + 60_000);
      }
      if (fireAt.getTime() > now.getTime() + 30_000 && lateness <= 4 * 60 * 60 * 1000) {
        const usualTimeLabel = formatReminderTime(pattern.usualEndOffsetMinutes);
        schedule.push({
          id: `signout-${openShift.id}`,
          kind: "signOut",
          fireAtEpochMs: fireAt.getTime(),
          title: "Shift still active",
          body: `Hi ${firstName}, your shift is still active, and you usually finish around ${usualTimeLabel}. Did you forget to sign out?`,
          weekdayName: pattern.weekdayName,
          usualTimeLabel,
          shiftId: openShift.id,
        });
      }
    }
  }

  return schedule;
}
