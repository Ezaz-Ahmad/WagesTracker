import { computeHours, isoDate, parseIsoDate } from "./date";

/**
 * A client-side mirror of the server's shift rules
 * (backend/src/security/shiftRules.ts), for immediate in-form feedback.
 *
 * The server is what actually enforces these — it re-validates every write
 * and is the only thing a determined client can't bypass. This copy exists
 * so forms can catch actual validation errors immediately. Long shifts use
 * a separate warning helper because they are unusual, not invalid.
 *
 * Deliberately NOT mirrored here: overlap detection. Deciding whether a shift
 * overlaps requires the user's other shifts *including ones outside whatever
 * range the client happens to have loaded*, so a client-side answer could be
 * confidently wrong. That one is left to the server, whose 409 the editor
 * surfaces as-is.
 *
 */

// A long-shift warning is reserved for a genuinely exceptional duration. A
// normal overnight shift is valid, so anything at or below one full day must
// stay silent until the user has finished the time picker and committed the
// complete pair.
export const UNUSUALLY_LONG_SHIFT_HOURS = 24;
export const LONG_SHIFT_WARNING = "This shift is unusually long. Please confirm that the start and finish times are correct.";
export const FUTURE_DATE_MESSAGE = "You can't log a shift for a future date.";
export const FUTURE_DATE_WARNING =
  "This date is in the future. Saving it can add hours or fuel to your reports before that work happens. Continue only if you are deliberately pre-entering a planned or scheduled entry.";

export function isFutureDate(dateISO: string, today = new Date()): boolean {
  const date = parseIsoDate(dateISO);
  if (Number.isNaN(date.getTime())) return false;
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return isoDate(date) > isoDate(localToday);
}

export function isUnusuallyLongShift(signIn: string | null, signOut: string | null): boolean {
  return !!signIn && !!signOut && signIn !== signOut && computeHours(signIn, signOut) > UNUSUALLY_LONG_SHIFT_HOURS;
}

/** True when a live shift has actually crossed the 24-hour threshold. */
export function isElapsedShiftOver24Hours(
  dateISO: string,
  signIn: string | null,
  now = new Date()
): boolean {
  if (!signIn) return false;
  const date = parseIsoDate(dateISO);
  if (Number.isNaN(date.getTime())) return false;
  const [hours, minutes, seconds = 0] = signIn.split(":").map(Number);
  const startedAt = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    hours,
    minutes,
    seconds,
    0
  );
  return now.getTime() - startedAt.getTime() > UNUSUALLY_LONG_SHIFT_HOURS * 60 * 60 * 1000;
}

/**
 * The first problem with this date/time combination, or null if there is
 * none. Message text is written for a person editing a form, not for a log.
 */
export function describeShiftTimes(
  dateISO: string,
  signIn: string | null,
  signOut: string | null,
  allowFutureDate = false,
  today = new Date()
): string | null {
  const date = parseIsoDate(dateISO);
  if (Number.isNaN(date.getTime())) return "That isn't a valid date.";

  // The browser is already in the current device timezone. The backend uses
  // its own clock plus X-Client-Time-Zone as the authoritative equivalent.
  if (isFutureDate(dateISO, today) && !allowFutureDate) return FUTURE_DATE_MESSAGE;

  if (!signIn || !signOut) return null;
  if (signIn === signOut) return "Sign-in and sign-out can't be the same time.";
  return null;
}
