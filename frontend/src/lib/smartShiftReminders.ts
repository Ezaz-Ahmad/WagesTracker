import type { Shift } from "./types";

export const SMART_REMINDER_MIN_SHIFTS = 4;
export const SMART_REMINDER_START_GRACE_MINUTES = 20;
export const SMART_REMINDER_END_GRACE_MINUTES = 20;

const MAX_SAMPLES = 12;
const MAX_ROUTINE_IDLE_DAYS = 14;
const ROUTINE_RESET_GAP_DAYS = 21;
const MIN_WEEKLY_CADENCE_RATIO = 0.6;
const CHANGE_PAUSE_STREAK = 2;
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
  day: Date;
  start: number;
  endOffset: number;
}

export interface SmartShiftLearningProgress {
  completedShiftCount: number;
  bestWeekdayName: typeof WEEKDAY_NAMES[number] | null;
  bestWeekdayCount: number;
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

function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round((startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) / 86_400_000);
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

function learnCluster(samples: readonly Sample[]): Sample[] | null {
  if (samples.length < SMART_REMINDER_MIN_SHIFTS) return null;
  const initialStart = median(samples.map((sample) => sample.start));
  const initialEnd = median(samples.map((sample) => sample.endOffset));
  const inliers = samples.filter((sample) =>
    Math.abs(sample.start - initialStart) <= START_TOLERANCE_MINUTES
    && Math.abs(sample.endOffset - initialEnd) <= END_TOLERANCE_MINUTES
  );
  if (
    inliers.length < SMART_REMINDER_MIN_SHIFTS
    || inliers.length / samples.length < MIN_INLIER_RATIO
  ) return null;

  const starts = inliers.map((sample) => sample.start);
  const ends = inliers.map((sample) => sample.endOffset);
  if (
    Math.max(...starts) - Math.min(...starts) > MAX_START_SPREAD_MINUTES
    || Math.max(...ends) - Math.min(...ends) > MAX_END_SPREAD_MINUTES
  ) return null;
  return inliers;
}

function hasWeeklyCadence(samples: readonly Sample[]): boolean {
  const recent = samples.slice(-6);
  const gaps = recent.slice(1).map((sample, index) => calendarDaysBetween(recent[index].day, sample.day));
  if (gaps.length < SMART_REMINDER_MIN_SHIFTS - 1) return false;
  const weeklyGaps = gaps.filter((gap) => gap === 7).length;
  return weeklyGaps / gaps.length >= MIN_WEEKLY_CADENCE_RATIO;
}

/**
 * Learns conservative weekday routines from completed shift history.
 * A weekday is returned only when all of these are true:
 * - at least four usable single-shift days exist;
 * - the recent dates show a weekly cadence and the routine is still current;
 * - at least 75% of usable samples agree within the start/end tolerances;
 * - the remaining cluster is tight enough to be useful.
 *
 * Completed shifts count whether their exact minutes were captured live,
 * entered later or corrected. Split-shift days, implausibly short/long
 * durations and robust statistical outliers never influence the learned time.
 */
export function analyseSmartShiftPatterns(
  shifts: readonly Shift[],
  asOf: Date = new Date()
): SmartShiftPattern[] {
  const today = startOfLocalDay(asOf);
  const todayKey = localDateKey(today);
  const completeByDate = new Map<string, Shift[]>();

  for (const shift of shifts) {
    if (!shift.signIn || !shift.signOut || shift.date > todayKey) continue;
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

    const samples: Sample[] = [];
    for (const date of workedDates) {
      const rows = completeByDate.get(date) ?? [];
      // A day with multiple shifts is a split/atypical workday; guessing
      // which start/end represents the person's routine would be intrusive.
      if (rows.length !== 1) continue;
      const shift = rows[0];
      const start = parseMinutes(shift.signIn!);
      const rawEnd = parseMinutes(shift.signOut!);
      const day = parseLocalDate(date);
      if (start === null || rawEnd === null || !day) continue;
      const endOffset = rawEnd <= start ? rawEnd + 24 * 60 : rawEnd;
      const duration = endOffset - start;
      if (duration < MIN_SHIFT_MINUTES || duration > MAX_SHIFT_MINUTES) continue;
      samples.push({ day, start, endOffset });
    }
    if (samples.length < SMART_REMINDER_MIN_SHIFTS) continue;

    // A gap of three weekday intervals starts a new routine era. This stops a
    // schedule from an old job/roster reactivating after a long break. The new
    // era earns trust independently after four consistent occurrences.
    let eraStart = 0;
    for (let index = 1; index < samples.length; index += 1) {
      if (calendarDaysBetween(samples[index - 1].day, samples[index].day) >= ROUTINE_RESET_GAP_DAYS) {
        eraStart = index;
      }
    }
    const era = samples.slice(eraStart).slice(-MAX_SAMPLES);
    if (era.length < SMART_REMINDER_MIN_SHIFTS || !hasWeeklyCadence(era)) continue;
    if (calendarDaysBetween(era.at(-1)!.day, today) > MAX_ROUTINE_IDLE_DAYS) continue;

    // Four recent, mutually consistent shifts always win. This is the roster-
    // change path: after four new hours, older hours cannot dominate merely
    // because they still exist in history.
    const latestFour = era.slice(-SMART_REMINDER_MIN_SHIFTS);
    let inliers = learnCluster(latestFour);
    if (!inliers) {
      // Otherwise retain a longer stable routine through one exceptional day
      // (overtime, cover shift, late arrival). Two consecutive disagreements
      // pause reminders instead of nagging while a possible change develops.
      const fallback = learnCluster(era);
      if (!fallback) continue;
      const accepted = new Set(fallback);
      let disagreementStreak = 0;
      for (let index = era.length - 1; index >= 0 && !accepted.has(era[index]); index -= 1) {
        disagreementStreak += 1;
      }
      if (disagreementStreak >= CHANGE_PAUSE_STREAK) continue;
      inliers = fallback;
    }

    const starts = inliers.map((sample) => sample.start);
    const ends = inliers.map((sample) => sample.endOffset);
    const startSpread = Math.max(...starts) - Math.min(...starts);
    const endSpread = Math.max(...ends) - Math.min(...ends);

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

/** Small, non-predictive summary for Settings. It explains progress without
 * claiming a routine is ready before the stricter cadence/time checks pass. */
export function getSmartShiftLearningProgress(
  shifts: readonly Shift[],
  asOf: Date = new Date()
): SmartShiftLearningProgress {
  const todayKey = localDateKey(startOfLocalDay(asOf));
  const datesByWeekday = Array.from({ length: 7 }, () => new Set<string>());
  let completedShiftCount = 0;
  for (const shift of shifts) {
    if (!shift.signIn || !shift.signOut || shift.date > todayKey) continue;
    completedShiftCount += 1;
    const weekday = weekdayForDate(shift.date);
    if (weekday !== null) datesByWeekday[weekday].add(shift.date);
  }

  const counts = Array.from({ length: 7 }, () => 0);
  for (let weekday = 0; weekday < 7; weekday += 1) {
    const dates = [...datesByWeekday[weekday]].sort()
      .map(parseLocalDate).filter((date): date is Date => !!date);
    if (dates.length === 0) continue;
    let eraStart = 0;
    for (let index = 1; index < dates.length; index += 1) {
      if (calendarDaysBetween(dates[index - 1], dates[index]) >= ROUTINE_RESET_GAP_DAYS) eraStart = index;
    }
    const currentEra = dates.slice(eraStart);
    const lastDate = currentEra.at(-1)!;
    counts[weekday] = calendarDaysBetween(lastDate, asOf) > MAX_ROUTINE_IDLE_DAYS
      ? 0
      : currentEra.length;
  }
  const bestWeekdayCount = Math.max(0, ...counts);
  const bestWeekday = counts.indexOf(bestWeekdayCount);
  return {
    completedShiftCount,
    bestWeekdayName: bestWeekdayCount > 0 ? WEEKDAY_NAMES[bestWeekday] : null,
    bestWeekdayCount,
  };
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

/** Produces one-shot native notifications. Nothing repeats weekly: only the
 * next occurrence of each learned weekday is scheduled, and every fresh data
 * load replaces that short horizon. Starting a shift removes today's alert
 * while still preserving the next learned occurrence. */
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

  for (const pattern of options.patterns) {
    // Include day 7 so completing/starting today's shift can immediately
    // preserve next week's one-shot request without requiring another app
    // launch in between. Only the first eligible occurrence is retained.
    for (let offset = 0; offset <= 7; offset += 1) {
      const date = addLocalDays(today, offset);
      if (date.getDay() !== pattern.weekday) continue;
      const dateKey = localDateKey(date);
      if (options.shifts.some((shift) => shift.date === dateKey && !!shift.signIn)) continue;

      let fireAt = atMinutesOnDate(
        date,
        pattern.usualStartMinutes + SMART_REMINDER_START_GRACE_MINUTES
      );
      const lateness = now.getTime() - fireAt.getTime();
      if (lateness >= 0) {
        // Opening the app shortly after a missed start should still help. A
        // much later launch is ambiguous, so skip today and retain next week.
        if (offset === 0 && lateness <= 4 * 60 * 60 * 1000) {
          fireAt = new Date(now.getTime() + 60_000);
        } else {
          continue;
        }
      }
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
      break;
    }
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
