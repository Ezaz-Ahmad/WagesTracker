import type { WeekStart } from "./types";

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

/** Monday=1, Sunday=0 per Date#getDay(); returns the first day of the week containing `d`. */
export function startOfWeek(d: Date, weekStartsOn: WeekStart): Date {
  const startIdx = weekStartsOn === "Sunday" ? 0 : 1;
  const diff = (d.getDay() - startIdx + 7) % 7;
  return addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -diff);
}

export function buildWeekDays(anchor: Date, weekStartsOn: WeekStart): Date[] {
  const start = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function computeHours(signIn: string | null, signOut: string | null): number {
  if (!signIn || !signOut) return 0;
  const [sh, sm] = signIn.split(":").map(Number);
  const [eh, em] = signOut.split(":").map(Number);
  const start = sh + sm / 60;
  const end = eh + em / 60;
  let diff = end - start;
  if (diff < 0) diff += 24;
  return Math.round(diff * 100) / 100;
}

export function fmt2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
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

export function weekRangeLabel(start: Date, end: Date): string {
  return `${shortLabel(start)} – ${shortLabel(end)}, ${end.getFullYear()}`;
}
