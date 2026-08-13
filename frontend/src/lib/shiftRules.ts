import { computeHours, isoDate, parseIsoDate } from "./date";

/**
 * A client-side mirror of the server's shift rules
 * (backend/src/security/shiftRules.ts), for immediate in-form feedback.
 *
 * The server is what actually enforces these — it re-validates every write
 * and is the only thing a determined client can't bypass. This copy exists
 * so the historical editor can say "that's longer than 16 hours" while you
 * are still looking at the field, instead of after a round trip on a
 * cold-starting backend. Same arrangement as the password policy, which is
 * mirrored for the same reason (see lib/passwordPolicy.ts).
 *
 * Deliberately NOT mirrored here: overlap detection. Deciding whether a shift
 * overlaps requires the user's other shifts *including ones outside whatever
 * range the client happens to have loaded*, so a client-side answer could be
 * confidently wrong. That one is left to the server, whose 409 the editor
 * surfaces as-is.
 *
 * Keep the two constants in step. If they drift, the client is merely
 * optimistic or pessimistic; the server's answer still wins.
 */

export const MAX_SHIFT_HOURS = 16;
export const MAX_FUTURE_DAYS = 1;

/**
 * The first problem with this date/time combination, or null if there is
 * none. Message text is written for a person editing a form, not for a log.
 */
export function describeShiftTimes(dateISO: string, signIn: string | null, signOut: string | null): string | null {
  const date = parseIsoDate(dateISO);
  if (Number.isNaN(date.getTime())) return "That isn't a valid date.";

  // Local midnight today, plus the same slack the server allows. The client
  // is in the user's own timezone so it could be stricter, but matching the
  // server avoids the worse failure: the form saying a value is fine and the
  // save then being rejected, or vice versa.
  const today = new Date();
  const latest = new Date(today.getFullYear(), today.getMonth(), today.getDate() + MAX_FUTURE_DAYS);
  if (isoDate(date) > isoDate(latest)) return "You can't log a shift for a future date.";

  if (!signIn || !signOut) return null;
  if (signIn === signOut) return "Sign-in and sign-out can't be the same time.";
  if (computeHours(signIn, signOut) > MAX_SHIFT_HOURS) {
    return `That's longer than ${MAX_SHIFT_HOURS} hours. If this was an overnight shift, check the times aren't the wrong way round.`;
  }
  return null;
}
