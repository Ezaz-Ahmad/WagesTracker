import type { WeekStart } from "./types";
import { startOfWeekISO } from "./weekBoundary.mjs";

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parseIsoDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function shortLabel(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function dayAbbr(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function sameDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Returns the configured first day of the week containing `d`. */
export function startOfWeek(d: Date, weekStartsOn: WeekStart): Date {
  return parseIsoDate(startOfWeekISO(isoDate(d), weekStartsOn));
}

export function buildWeekDays(anchor: Date, weekStartsOn: WeekStart): Date[] {
  const start = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Parses "HH:MM" or "HH:MM:SS" into seconds since midnight. */
function timeToSeconds(t: string): number {
  const [h, m, s = 0] = t.split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

/**
 * Exact elapsed hours between two "HH:MM" or "HH:MM:SS" clock times — no
 * rounding up to a minute and no minimum. A worker is paid for precisely the
 * time worked: 1 second in is 1 second's worth of pay, no more, no less, so
 * it's fair to both the worker and whoever's paying. Rounded to six decimal
 * places purely to avoid floating-point noise (that's sub-millisecond
 * precision, far finer than a cent at any real wage) — callers that display
 * this should format it (see `fmt2`), not print it raw.
 *
 * Overnight shifts ARE supported: a sign-out earlier than sign-in (e.g.
 * 10:00 PM -> 6:00 AM) reads as crossing midnight into the next calendar
 * day, so the raw negative diff gets 24h added back rather than treated as
 * invalid. The backend enforces the one combination that's genuinely
 * invalid — an identical sign-in/sign-out (see backend/src/routes/
 * shifts.ts) — which is why that specific case falls back to 0 here too,
 * same as a shift with no sign-out yet, instead of reading as a 24-hour
 * shift.
 *
 * A shift's full duration — even one that crosses midnight — is always
 * attributed to whichever calendar date the shift record itself is filed
 * under (its starting day), never split across the two days it technically
 * spans. There's no separate "end date": see the `date` field on Shift
 * (lib/types.ts) and how aggregate.ts groups by it.
 */
export function computeHours(signIn: string | null, signOut: string | null): number {
  if (!signIn || !signOut) return 0;
  let diffSec = timeToSeconds(signOut) - timeToSeconds(signIn);
  if (diffSec < 0) diffSec += 24 * 3600;
  if (diffSec <= 0) return 0;

  return Math.round((diffSec / 3600) * 1_000_000) / 1_000_000;
}

export function fmt2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** Formats a "HH:MM" 24-hour string as a 12-hour clock string, e.g. "14:05" -> "2:05 PM". */
export function formatTime12(hhmm: string | null | undefined): string {
  if (!hhmm) return "—";
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad2(m)} ${period}`;
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const sec = totalSec % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

export function nowHHMM(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

/** Same as `nowHHMM` but with seconds — used by the sign-in/sign-out buttons
 * so `computeHours` can tell how far into a minute a shift actually started
 * or ended, instead of losing that precision at the moment it's captured. */
export function nowHHMMSS(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`;
}

export function weekRangeLabel(start: Date, end: Date): string {
  return `${shortLabel(start)} – ${shortLabel(end)}, ${end.getFullYear()}`;
}
