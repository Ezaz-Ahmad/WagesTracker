import { timeToSeconds, type ShiftTimesInput } from "./shiftRules.js";

export interface ConflictShift extends ShiftTimesInput {
  jobName: string;
  location: string;
}

export interface ShiftConflict {
  kind: "overlap" | "running";
  attempted: ConflictShift;
  conflicts: ConflictShift[];
  totalConflicts: number;
}

function schedule(shift: ConflictShift): string {
  const dateLabel = (date: string) => new Intl.DateTimeFormat("en-AU", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
  const timeLabel = (time: string) => {
    const [hours, minutes, seconds = "00"] = time.split(":");
    const hour = Number(hours);
    return `${hour % 12 || 12}:${minutes}${seconds !== "00" ? `:${seconds}` : ""} ${hour < 12 ? "am" : "pm"}`;
  };
  if (!shift.signIn) return dateLabel(shift.date);
  const start = `${dateLabel(shift.date)}, ${timeLabel(shift.signIn)}`;
  if (!shift.signOut) return `${start} – still running`;
  const overnight = timeToSeconds(shift.signOut) < timeToSeconds(shift.signIn);
  const endDate = overnight ? new Date(Date.parse(`${shift.date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10) : shift.date;
  return `${start} – ${overnight ? `${dateLabel(endDate)}, ` : ""}${timeLabel(shift.signOut)}`;
}

/** Only caller-owned records supplied by the route may enter this response.
 * Do not include credentials, earnings, addresses or full database rows. */
export function shiftConflictResponse(kind: ShiftConflict["kind"], attempted: ConflictShift, conflicts: readonly ConflictShift[]) {
  const describe = (shift: ConflictShift): ConflictShift => ({
    jobName: shift.jobName, location: shift.location, date: shift.date, signIn: shift.signIn, signOut: shift.signOut,
  });
  const summary = conflicts.slice(0, 5).map(describe);
  const first = summary[0];
  const error = kind === "running"
    ? `You already have an open shift${first ? ` at ${first.jobName}: ${schedule(first)}` : ""}. Finish or correct it before starting another.`
    : `This shift overlaps ${first ? `${first.jobName}: ${schedule(first)}` : "a saved shift"}.${conflicts.length > 1 ? ` It also overlaps ${conflicts.length - 1} other saved ${conflicts.length === 2 ? "shift" : "shifts"}.` : ""}`;
  return { error, code: kind === "running" ? "OPEN_SHIFT_EXISTS" : "SHIFT_OVERLAP", conflict: { kind, attempted: describe(attempted), conflicts: summary, totalConflicts: conflicts.length } satisfies ShiftConflict };
}
