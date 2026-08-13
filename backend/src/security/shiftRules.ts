/**
 * The rules a shift's date and times have to satisfy, in one place.
 *
 * Before this existed the API enforced exactly two things: a shift can't be
 * zero-length, and a user can't have two open shifts at once. Nothing stopped
 * a shift dated in 2099, nothing stopped two shifts claiming the same hours,
 * and nothing caught the am/pm slip that turns an 8-hour night into a
 * 23-hour one. Historical editing makes all three considerably easier to hit
 * — you're typing dates and times from memory, days or weeks after the fact,
 * with no clock-in button to get them right for you.
 *
 * These apply to every shift write, current-week and historical alike. A rule
 * that only guarded the past would be strange in both directions: you could
 * create an overlap today and then be refused when you tried to correct one
 * from last week.
 *
 * This is the authoritative copy. `frontend/src/lib/shiftRules.ts` mirrors it
 * for immediate in-form feedback, exactly as the password policy is mirrored
 * (see security/passwordPolicy.ts) — the client copy is a courtesy, this one
 * is the enforcement.
 */

export const ZERO_LENGTH_MESSAGE = "Sign-in and sign-out can't be the same time.";
export const FUTURE_DATE_MESSAGE = "You can't log a shift for a future date.";
export const OVERLAP_MESSAGE = "That overlaps another shift you've already logged.";

export const CLIENT_TIME_ZONE_HEADER = "X-Client-Time-Zone";
export const TIME_ZONE_REQUIRED_MESSAGE = "A valid device time zone is required to save a shift.";

/**
 * Accept only named zones understood by this Node runtime. In particular,
 * numeric offsets are intentionally rejected: an offset such as +10:00 has
 * no daylight-saving rules and therefore cannot identify the user's local
 * calendar date reliably throughout the year.
 */
export function isSupportedIanaTimeZone(value: string): boolean {
  const candidate = value.trim();
  if (!candidate || /^[+-]\d{2}:?\d{2}$/.test(candidate)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format();
    return true;
  } catch {
    return false;
  }
}

/** Derives YYYY-MM-DD in a validated zone from a server-owned instant. */
export function localDateForTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  // Rejects 2026-02-30 and friends, which the regex alone happily accepts.
  const [y, m, d] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}

export function isValidTime(time: string): boolean {
  return TIME_RE.test(time);
}

/** Seconds since midnight. "HH:MM" and "HH:MM:SS" both accepted — the
 * sign-in/out buttons capture seconds so short shifts round fairly. */
export function timeToSeconds(time: string): number {
  const [h, m, s] = time.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

/**
 * A shift's length in seconds, wrapping past midnight — the same rule as the
 * frontend's `computeHours` (frontend/src/lib/date.ts), which is what every
 * total in the app is built from. A sign-out earlier than sign-in means the
 * shift crossed into the next day; it is not an error.
 */
export function durationSeconds(signIn: string, signOut: string): number {
  let diff = timeToSeconds(signOut) - timeToSeconds(signIn);
  if (diff < 0) diff += 24 * 3600;
  return diff;
}

/** Absolute start/end instants for a shift, as epoch seconds in a fixed
 * frame. Dates are treated as UTC midnight throughout — the shift's stored
 * `date` is a plain calendar day with no zone, and every shift in a
 * comparison goes through the same conversion, so intervals are directly
 * comparable even though the absolute values aren't real instants. */
export function shiftInterval(date: string, signIn: string, signOut: string): { start: number; end: number } {
  const dayStart = Date.parse(`${date}T00:00:00Z`) / 1000;
  const start = dayStart + timeToSeconds(signIn);
  return { start, end: start + durationSeconds(signIn, signOut) };
}

/** Two half-open intervals overlap when each starts before the other ends.
 * Half-open is what makes back-to-back shifts legal: 09:00-13:00 followed by
 * 13:00-17:00 touch at a point and do not overlap, which is a real and
 * common split-shift pattern. */
export function intervalsOverlap(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

export interface ShiftTimesInput {
  date: string;
  signIn: string | null;
  signOut: string | null;
}

/**
 * Everything checkable without looking at the user's other shifts.
 * Returns the first problem found, or null when the shift is acceptable.
 *
 * `localToday` is derived by the caller from the backend clock and the
 * validated request timezone. Keeping that conversion outside this helper
 * makes the calendar rule deterministic and directly testable.
 */
export function validateShiftTimes(input: ShiftTimesInput, localToday: string): string | null {
  const { date, signIn, signOut } = input;

  if (!isValidDate(date)) return "date must be a real calendar date in YYYY-MM-DD form";
  if (signIn !== null && !isValidTime(signIn)) return "signIn must be HH:MM";
  if (signOut !== null && !isValidTime(signOut)) return "signOut must be HH:MM";

  if (date > localToday) return FUTURE_DATE_MESSAGE;

  // A part-filled shift (signed in, not yet out) is a legitimate in-progress
  // state — only a complete pair can be measured.
  if (signIn && signOut) {
    if (signIn === signOut) return ZERO_LENGTH_MESSAGE;
  }

  return null;
}

/**
 * Whether a complete shift would overlap any of `others`.
 *
 * `others` must already exclude the shift being edited (a shift always
 * overlaps itself) and must be scoped to the same user. Incomplete shifts on
 * either side are skipped: they have no measurable interval, and the
 * one-open-shift rule covers the in-progress case separately.
 *
 * Callers only need to supply neighbours within a day either side. A stored
 * shift is always shorter than 24 hours (equal times are rejected), so
 * nothing further out can reach back.
 */
export function findOverlap(
  candidate: ShiftTimesInput,
  others: readonly { id: string; date: string; signIn: string | null; signOut: string | null }[]
): { id: string } | null {
  if (!candidate.signIn || !candidate.signOut) return null;
  const a = shiftInterval(candidate.date, candidate.signIn, candidate.signOut);

  for (const other of others) {
    if (!other.signIn || !other.signOut) continue;
    const b = shiftInterval(other.date, other.signIn, other.signOut);
    if (intervalsOverlap(a, b)) return { id: other.id };
  }
  return null;
}
