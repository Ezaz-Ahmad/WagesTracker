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

/** Sanity bound on a single shift, not a labour-law limit.
 *
 * Its real job is catching the reversed-times slip. Because overnight shifts
 * are supported by wraparound (22:00 -> 06:00 = 8h), *every* pair of distinct
 * times is a "valid" duration somewhere in (0, 24) — so a mistyped 06:00 ->
 * 22:00 when you meant 22:00 -> 06:00 silently records 16 hours instead of 8,
 * and a 09:00 -> 08:00 slip records 23. Neither is rejectable by ordering
 * rules, because for overnight shifts the "wrong" order is the correct one.
 * A ceiling is the only thing that separates them.
 *
 * 16 hours clears any genuine double shift while still catching the
 * near-24-hour results a typo produces. */
export const MAX_SHIFT_HOURS = 16;

/** How far past the server's own "today" a shift date may be.
 *
 * Not zero, and that's deliberate. The client sends a date derived from the
 * *browser's* local calendar, and this server runs in UTC. For a user in
 * Sydney (UTC+10), 9am on the 14th is 11pm on the 13th here — their perfectly
 * ordinary "today" arrives looking like tomorrow. One day of slack covers
 * every real timezone offset (UTC-12 to UTC+14 spans just over one day either
 * side) without opening the door to the thing this actually guards against,
 * which is a mistyped year or month putting a shift months or years out. */
export const MAX_FUTURE_DAYS = 1;

export const ZERO_LENGTH_MESSAGE = "Sign-in and sign-out can't be the same time.";
export const FUTURE_DATE_MESSAGE = "You can't log a shift for a future date.";
export const MAX_DURATION_MESSAGE = `A shift can't be longer than ${MAX_SHIFT_HOURS} hours. Check the sign-in and sign-out times.`;
export const OVERLAP_MESSAGE = "That overlaps another shift you've already logged.";

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
 * `today` is injected rather than read from the clock so this is testable
 * without freezing time, and so the caller decides which clock is
 * authoritative.
 */
export function validateShiftTimes(input: ShiftTimesInput, today: Date): string | null {
  const { date, signIn, signOut } = input;

  if (!isValidDate(date)) return "date must be a real calendar date in YYYY-MM-DD form";
  if (signIn !== null && !isValidTime(signIn)) return "signIn must be HH:MM";
  if (signOut !== null && !isValidTime(signOut)) return "signOut must be HH:MM";

  const latestAllowed = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) + MAX_FUTURE_DAYS * 86_400_000;
  if (Date.parse(`${date}T00:00:00Z`) > latestAllowed) return FUTURE_DATE_MESSAGE;

  // A part-filled shift (signed in, not yet out) is a legitimate in-progress
  // state — only a complete pair can be measured.
  if (signIn && signOut) {
    if (signIn === signOut) return ZERO_LENGTH_MESSAGE;
    if (durationSeconds(signIn, signOut) > MAX_SHIFT_HOURS * 3600) return MAX_DURATION_MESSAGE;
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
 * Callers only need to supply neighbours within a day either side. An
 * overnight shift can reach at most `MAX_SHIFT_HOURS` past its own midnight,
 * so nothing further out can reach back.
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
