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

export const UNUSUALLY_LONG_SHIFT_HOURS = 16;
export const LONG_SHIFT_WARNING = "This shift is unusually long. Please confirm that the start and finish times are correct.";

export function isUnusuallyLongShift(signIn: string | null, signOut: string | null): boolean {
  return !!signIn && !!signOut && signIn !== signOut && computeHours(signIn, signOut) > UNUSUALLY_LONG_SHIFT_HOURS;
}

/**
 * The first problem with this date/time combination, or null if there is
 * none. Message text is written for a person editing a form, not for a log.
 */
export function describeShiftTimes(dateISO: string, signIn: string | null, signOut: string | null): string | null {
  const date = parseIsoDate(dateISO);
  if (Number.isNaN(date.getTime())) return "That isn't a valid date.";

  // The browser is already in the current device timezone. The backend uses
  // its own clock plus X-Client-Time-Zone as the authoritative equivalent.
  const today = new Date();
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (isoDate(date) > isoDate(localToday)) return "You can't log a shift for a future date.";

  if (!signIn || !signOut) return null;
  if (signIn === signOut) return "Sign-in and sign-out can't be the same time.";
  return null;
}
