export interface ConflictShift {
  jobName: string;
  location: string;
  date: string;
  signIn: string | null;
  signOut: string | null;
}

export interface ShiftConflict {
  kind: "overlap" | "running";
  attempted: ConflictShift;
  conflicts: ConflictShift[];
  totalConflicts: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function isShift(value: unknown): value is ConflictShift {
  if (!isRecord(value)) return false;
  if (typeof value.jobName !== "string" || !value.jobName.trim() || value.jobName.length > 240 || typeof value.location !== "string" || value.location.length > 300) return false;
  if (typeof value.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)) return false;
  const parsed = new Date(`${value.date}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value.date) return false;
  return [value.signIn, value.signOut].every(time => time === null || typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time));
}

/** Treat server error details as untrusted input; old or malformed responses
 * must still produce a usable ordinary error, never break the dialog. */
export function parseShiftConflict(value: unknown): ShiftConflict | undefined {
  if (!isRecord(value) || (value.kind !== "overlap" && value.kind !== "running") || !isShift(value.attempted)) return undefined;
  if (!Array.isArray(value.conflicts) || value.conflicts.length < 1 || value.conflicts.length > 5 || !value.conflicts.every(isShift)) return undefined;
  if (!Number.isSafeInteger(value.totalConflicts) || Number(value.totalConflicts) < value.conflicts.length) return undefined;
  const describe = (shift: ConflictShift): ConflictShift => ({ jobName: shift.jobName, location: shift.location, date: shift.date, signIn: shift.signIn, signOut: shift.signOut });
  return { kind: value.kind as ShiftConflict["kind"], attempted: describe(value.attempted), conflicts: value.conflicts.map(describe), totalConflicts: Number(value.totalConflicts) };
}

export function conflictSchedule(shift: ConflictShift) {
  const dateLabel = (date: string) => new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const seconds = (time: string) => { const [h, m, s = 0] = time.split(":").map(Number); return h * 3600 + m * 60 + s; };
  const timeLabel = (time: string | null) => {
    if (!time) return null;
    const [hours, minutes, sec = "00"] = time.split(":");
    const h = Number(hours);
    return `${h % 12 || 12}:${minutes}${sec !== "00" ? `:${sec}` : ""} ${h < 12 ? "am" : "pm"}`;
  };
  const overnight = !!(shift.signIn && shift.signOut && seconds(shift.signOut) < seconds(shift.signIn));
  const endDate = overnight ? new Date(Date.parse(`${shift.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : shift.date;
  return { date: dateLabel(shift.date), start: timeLabel(shift.signIn), end: timeLabel(shift.signOut), endDate: overnight ? dateLabel(endDate) : null };
}
