import { addDays, computeHours, dayAbbr, fmt2, formatTime12, isoDate, shortLabel, startOfWeek } from "./date";
import type { DayExpense, Shift, WeekExtra, WeekStart } from "./types";

export interface ShiftComputed {
  id: string | null;
  shiftIndex: number;
  location: string;
  workLocationId?: string | null;
  signIn: string | null;
  signOut: string | null;
  hours: number;
  hoursLabel: string;
  canRemove: boolean;
}

export interface DayComputed {
  dateISO: string;
  dayAbbr: string;
  dateLabel: string;
  isToday: boolean;
  shifts: ShiftComputed[];
  hours: number;
  hoursLabel: string;
  moneyLabel: string;
  fuelCost: number;
  fuelCostLabel: string;
  /** Present on report data when the API supplied source metadata. Kept
   * optional so older callers/fixtures that only have a date and amount stay
   * compatible. */
  fuelSource?: "automatic" | "manual" | "mixed" | null;
}

export interface WeekSummary {
  startISO: string;
  /** Last day of the week, ISO. Additive: the end date was previously
   * computed here and then thrown away, surviving only inside the display
   * `label` ("Aug 3 – 9"), which omits the year and cannot be parsed back.
   * History needs the real date to name a PDF and to rebuild the week's
   * days, and re-deriving it at the call site would mean a second place that
   * has to agree about how long a week is. */
  endISO: string;
  label: string;
  short: string;
  hours: number;
  earnings: number;
  inProgress?: boolean;
}

export interface ShiftRow {
  day: string;
  date: string;
  location: string;
  signIn: string;
  signOut: string;
  hours: number;
  hoursLabel: string;
  moneyLabel: string;
}

export interface LocationBreakdown {
  location: string;
  hours: number;
  hoursLabel: string;
  moneyLabel: string;
}

/**
 * The shift that's currently "open" (signed in, no sign-out yet) across
 * *every* loaded shift — not just today's. Replaces a previous today-only
 * lookup (`shifts.filter(s => s.date === todayISO)`) that stopped finding an
 * overnight shift the instant the calendar date rolled over at midnight:
 * the shift itself never changed, but "today" did, so a same-day filter
 * lost track of it — the UI flipped back to "Sign in," the timer stopped,
 * and pressing the button again started a *second* shift instead of ending
 * the original one.
 *
 * In ordinary use there's at most one open shift at a time (the backend
 * now enforces this — see routes/shifts.ts), so this mostly just needs to
 * find it regardless of what today's date is. The tie-break by date/sign-in
 * when more than one somehow exists (e.g. old data from before that
 * enforcement existed) is a defensive fallback, not the expected case.
 */
export function findOpenShift(shifts: Shift[]): Shift | null {
  let open: Shift | null = null;
  for (const s of shifts) {
    if (!s.signIn || s.signOut) continue;
    if (!open || s.date > open.date || (s.date === open.date && (s.signIn ?? "") > (open.signIn ?? ""))) {
      open = s;
    }
  }
  return open;
}

/**
 * Whether `dateISO` falls within the 7 consecutive days in `weekDays` (as
 * produced by `buildWeekDays`). ISO date strings (`YYYY-MM-DD`) sort the
 * same lexicographically as chronologically, so a plain range check against
 * the first/last day is exact and doesn't need to loop or parse dates.
 *
 * Used to decide whether an *open* overnight shift's live, still-ticking
 * hours belong in the week currently being displayed. Without this check,
 * a shift that started the night before a week boundary (e.g. Sunday night
 * into Monday morning, with the week starting Monday) would show its live
 * hours in the *new* week the moment midnight passed, then — once signed
 * out — have those same hours actually save under the *previous* week (its
 * real start date), making the total visibly jump backward. Gating the live
 * contribution on "does this shift's date actually belong to the week I'm
 * showing" keeps the displayed and saved totals consistent throughout,
 * rather than agreeing only before midnight and after sign-out.
 */
export function isDateInWeek(dateISO: string, weekDays: Date[]): boolean {
  if (weekDays.length === 0) return false;
  const startISO = isoDate(weekDays[0]);
  const endISO = isoDate(weekDays[weekDays.length - 1]);
  return dateISO >= startISO && dateISO <= endISO;
}

/**
 * Buckets shifts by their single `date` field — which is also the *only*
 * place an overnight shift's calendar date lives. A shift has no separate
 * end-date: `date` is always the day it started (sign-in), so a 10:00 PM ->
 * 6:00 AM shift filed under, say, the 5th shows up here (and therefore in
 * every day/week/month/year total below) entirely on the 5th's bucket, with
 * nothing carried over onto the 6th even though the shift's actual clock
 * time runs past midnight into it. See computeHours in date.ts for the
 * matching duration math.
 */
export function groupByDate(shifts: Shift[]): Map<string, Shift[]> {
  const map = new Map<string, Shift[]>();
  for (const s of shifts) {
    const list = map.get(s.date) ?? [];
    list.push(s);
    map.set(s.date, list);
  }
  return map;
}

/** One fuel-cost entry per day, so a straight date→amount lookup (unlike
 * shifts, which can have several per day). */
export function groupExpensesByDate(expenses: DayExpense[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of expenses) map.set(e.date, e.fuelCost);
  return map;
}

export function buildDayComputed(
  date: Date,
  shiftsForDate: Shift[],
  isToday: boolean,
  currency: string,
  rate: number,
  fuelCost: number = 0
): DayComputed {
  const raw = shiftsForDate.length
    ? shiftsForDate
    : [{ id: "", date: isoDate(date), location: "", signIn: null, signOut: null }];
  const shifts: ShiftComputed[] = raw.map((sh, i) => {
    const hours = computeHours(sh.signIn, sh.signOut);
    return {
      id: sh.id || null,
      shiftIndex: i,
      location: sh.location || "",
      workLocationId: sh.workLocationId ?? null,
      signIn: sh.signIn,
      signOut: sh.signOut,
      hours,
      hoursLabel: hours > 0 ? `${fmt2(hours)}h` : "—",
      canRemove: raw.length > 1,
    };
  });
  // Keep high precision through the sum (see computeHours) so short shifts
  // don't get rounded away before they're added up — only the display label
  // (fmt2, 2dp) rounds for humans.
  const hours = Math.round(shifts.reduce((a, s) => a + s.hours, 0) * 1_000_000) / 1_000_000;
  // Fuel cost is a flat reimbursement added straight onto that day's earnings,
  // on top of hours × rate — not a deduction.
  const dayEarnings = Math.round((hours * rate + fuelCost) * 100) / 100;
  return {
    dateISO: isoDate(date),
    dayAbbr: dayAbbr(date),
    dateLabel: shortLabel(date),
    isToday,
    shifts,
    hours,
    hoursLabel: hours > 0 ? `${fmt2(hours)}h` : "—",
    moneyLabel: hours > 0 || fuelCost > 0 ? currency + fmt2(dayEarnings) : "—",
    fuelCost,
    fuelCostLabel: fuelCost > 0 ? currency + fmt2(fuelCost) : "—",
  };
}

export function buildWeekDaysComputed(
  weekDays: Date[],
  shiftsByDate: Map<string, Shift[]>,
  today: Date,
  currency: string,
  rate: number,
  expensesByDate: Map<string, number> = new Map()
): DayComputed[] {
  return weekDays.map((d) => {
    const key = isoDate(d);
    const isToday = key === isoDate(today);
    return buildDayComputed(d, shiftsByDate.get(key) ?? [], isToday, currency, rate, expensesByDate.get(key) ?? 0);
  });
}

export function weekTotals(
  days: DayComputed[],
  rate: number
): { hours: number; earnings: number; daysLogged: number; fuelCost: number } {
  const hours = Math.round(days.reduce((a, d) => a + d.hours, 0) * 1_000_000) / 1_000_000;
  const fuelCost = Math.round(days.reduce((a, d) => a + d.fuelCost, 0) * 100) / 100;
  return {
    hours,
    earnings: Math.round((hours * rate + fuelCost) * 100) / 100,
    daysLogged: days.filter((d) => d.hours > 0).length,
    fuelCost,
  };
}

/** Finds the single "other earnings" entry for the week that starts on
 * `weekStartISO`, if the user has added one. */
export function weekExtraFor(weekStartISO: string, weekExtras: WeekExtra[]): WeekExtra | undefined {
  return weekExtras.find((w) => w.weekStart === weekStartISO);
}

/**
 * Current logging streak: consecutive calendar days, walking backwards, that
 * have at least one shift with real hours on them. Not scoped to the current
 * week — walks across week boundaries using the full shift history, so a
 * streak that started last week keeps counting.
 *
 * If today has nothing logged yet, that's expected (the day isn't over) so
 * the walk starts from yesterday instead of zeroing the streak out from
 * under someone mid-day.
 */
export function computeStreak(shiftsByDate: Map<string, Shift[]>, today: Date): number {
  const hasHours = (d: Date) => {
    const dayShifts = shiftsByDate.get(isoDate(d));
    if (!dayShifts || dayShifts.length === 0) return false;
    return dayShifts.some((s) => computeHours(s.signIn, s.signOut) > 0);
  };

  let cursor = today;
  if (!hasHours(cursor)) cursor = addDays(cursor, -1);

  let streak = 0;
  // 5-year cap matches the data-retention window elsewhere in the app — a
  // sane upper bound so this can never spin forever on bad data.
  for (let i = 0; i < 1826; i++) {
    if (!hasHours(cursor)) break;
    streak++;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export function buildShiftRows(days: DayComputed[], currency: string, rate: number): ShiftRow[] {
  const rows: ShiftRow[] = [];
  for (const d of days) {
    for (const sh of d.shifts) {
      if (!sh.signIn && !sh.signOut) continue;
      rows.push({
        day: d.dayAbbr,
        date: d.dateLabel,
        location: sh.location || "Unspecified",
        signIn: formatTime12(sh.signIn),
        signOut: formatTime12(sh.signOut),
        hours: sh.hours,
        hoursLabel: sh.hoursLabel,
        moneyLabel: sh.hours > 0 ? currency + fmt2(sh.hours * rate) : "—",
      });
    }
  }
  return rows;
}

export function buildLocationBreakdown(rows: ShiftRow[]): LocationBreakdown[] {
  const map = new Map<string, { hours: number; earnings: number }>();
  for (const r of rows) {
    if (r.hours <= 0) continue;
    const cur = map.get(r.location) ?? { hours: 0, earnings: 0 };
    cur.hours += r.hours;
    cur.earnings += Number(r.moneyLabel.replace(/[^0-9.]/g, "")) || 0;
    map.set(r.location, cur);
  }
  return Array.from(map.entries()).map(([location, v]) => ({
    location,
    hours: Math.round(v.hours * 1_000_000) / 1_000_000,
    hoursLabel: `${fmt2(v.hours)}h`,
    moneyLabel: `$${v.earnings.toFixed(2)}`,
  }));
}

function shiftsInRange(shifts: Shift[], startISO: string, endISO: string): Shift[] {
  return shifts.filter((s) => s.date >= startISO && s.date <= endISO);
}

function sumHours(shifts: Shift[]): number {
  return Math.round(shifts.reduce((a, s) => a + computeHours(s.signIn, s.signOut), 0) * 1_000_000) / 1_000_000;
}

function expensesInRange(expenses: DayExpense[], startISO: string, endISO: string): DayExpense[] {
  return expenses.filter((e) => e.date >= startISO && e.date <= endISO);
}

function sumFuelCost(expenses: DayExpense[]): number {
  return Math.round(expenses.reduce((a, e) => a + e.fuelCost, 0) * 100) / 100;
}

function weekExtrasInRange(weekExtras: WeekExtra[], startISO: string, endISO: string): WeekExtra[] {
  return weekExtras.filter((w) => w.weekStart >= startISO && w.weekStart <= endISO);
}

function sumWeekExtras(weekExtras: WeekExtra[]): number {
  return Math.round(weekExtras.reduce((a, w) => a + w.amount, 0) * 100) / 100;
}

/**
 * Completed weeks strictly before the week containing `today`, oldest first.
 * When `signupDate` is given, weeks that ended before the account existed are
 * skipped entirely — history should start the week the user actually signed up,
 * not stretch back to an arbitrary fixed count of empty weeks.
 */
/**
 * Total earnings for the single week beginning `weekStart`, from stored data
 * only (no live/in-progress shift).
 *
 * This is THE weekly-earnings formula — hours x rate, plus fuel
 * reimbursement, plus that week's "other earnings" entry. `weekTotals` +
 * `weekExtraFor` compute the same thing for the current week from
 * already-built day rows, and `buildWeeklyHistory` calls this for each
 * historical week, so there is exactly one definition of what a week earns.
 * That matters more than it looks: the Home headline and the "vs prior week"
 * comparison used to be derived separately, and could disagree.
 *
 * `hasRecords` distinguishes "that week earned nothing" from "there is no
 * data for that week at all" — a week before the account existed is not a
 * week with zero earnings, and the two deserve different wording.
 */
export function weekEarningsFor(
  weekStart: Date,
  shifts: Shift[],
  expenses: DayExpense[],
  weekExtras: WeekExtra[],
  rate: number
): { earnings: number; hours: number; fuelCost: number; extra: number; hasRecords: boolean } {
  const startISO = isoDate(weekStart);
  const endISO = isoDate(addDays(weekStart, 6));
  const weekShifts = shiftsInRange(shifts, startISO, endISO);
  const weekExpenses = expensesInRange(expenses, startISO, endISO);
  const extraEntry = weekExtraFor(startISO, weekExtras);

  const hours = sumHours(weekShifts);
  const fuelCost = sumFuelCost(weekExpenses);
  const extra = extraEntry?.amount ?? 0;

  return {
    hours,
    fuelCost,
    extra,
    earnings: Math.round((hours * rate + fuelCost + extra) * 100) / 100,
    hasRecords: weekShifts.length > 0 || weekExpenses.length > 0 || extraEntry !== undefined,
  };
}

export function buildWeeklyHistory(
  allShifts: Shift[],
  today: Date,
  weekStartsOn: WeekStart,
  rate: number,
  count: number,
  signupDate?: Date,
  allExpenses: DayExpense[] = [],
  allWeekExtras: WeekExtra[] = []
): WeekSummary[] {
  const currentWeekStart = startOfWeek(today, weekStartsOn);
  const weeks: WeekSummary[] = [];
  for (let i = count; i >= 1; i--) {
    const start = addDays(currentWeekStart, -7 * i);
    const end = addDays(start, 6);
    if (signupDate && end < signupDate) continue;
    const hours = sumHours(shiftsInRange(allShifts, isoDate(start), isoDate(end)));
    const fuelCost = sumFuelCost(expensesInRange(allExpenses, isoDate(start), isoDate(end)));
    const extra = weekExtraFor(isoDate(start), allWeekExtras)?.amount ?? 0;
    weeks.push({
      startISO: isoDate(start),
      endISO: isoDate(end),
      label: `${shortLabel(start)} – ${end.getMonth() === start.getMonth() ? end.getDate() : shortLabel(end)}`,
      short: shortLabel(start),
      hours,
      earnings: Math.round((hours * rate + fuelCost + extra) * 100) / 100,
    });
  }
  return weeks;
}

export interface ChartPoint {
  x: number;
  y: number;
  labelY: number;
  labelAnchor: "start" | "middle" | "end";
  short: string;
  valueLabel: string;
  dotColor: string;
  dotStroke: string;
}

export function buildChartSource(
  history: WeekSummary[],
  currentHours: number,
  currentEarnings: number
): WeekSummary[] {
  // "current" is a sentinel, not a date — this point represents the week in
  // progress and is never addressed by date. endISO matches it rather than
  // inventing a real-looking date nothing should parse.
  return [
    ...history,
    { startISO: "current", endISO: "current", label: "This week", short: "Now", hours: currentHours, earnings: currentEarnings, inProgress: true },
  ];
}

export function buildChart(chartSource: WeekSummary[], metric: "earnings" | "hours", currency: string) {
  const maxVal = Math.max(...chartSource.map((w) => (metric === "earnings" ? w.earnings : w.hours)), 1);
  const chartW = 320;
  const chartH = 118;
  // Keep endpoint dots inside the SVG, while anchoring their labels inward.
  // Previously the first/last points sat at x=0/320 with centred text, so
  // half of each value was outside the viewBox and visibly clipped.
  const plotInset = 8;
  const plotW = chartW - plotInset * 2;
  const n = chartSource.length;
  const points: ChartPoint[] = chartSource.map((w, i) => {
    const val = metric === "earnings" ? w.earnings : w.hours;
    const x = n > 1 ? Math.round(plotInset + (i * plotW) / (n - 1)) : chartW / 2;
    const y = Math.round(chartH - Math.max(6, (val / maxVal) * (chartH - 16)));
    return {
      x,
      y,
      labelY: Math.max(10, y - 10),
      labelAnchor: n === 1 ? "middle" : i === 0 ? "start" : i === n - 1 ? "end" : "middle",
      short: w.short,
      valueLabel: metric === "earnings" ? currency + fmt2(val) : `${Math.round(val * 10) / 10}h`,
      dotColor: w.inProgress ? "var(--color-bg)" : "var(--color-accent)",
      dotStroke: "var(--color-accent)",
    };
  });
  const linePoints = points.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPath = points.length
    ? `M${points[0].x},${chartH} ${points.map((p) => `L${p.x},${p.y}`).join(" ")} L${points[points.length - 1].x},${chartH} Z`
    : "";
  return { points, linePoints, areaPath };
}

export interface Bar {
  short: string;
  valueLabel: string;
  barStyle: string;
  barColor: string;
}

export function buildBars(items: WeekSummary[], metric: "earnings" | "hours", currency: string): Bar[] {
  const maxVal = Math.max(...items.map((w) => (metric === "earnings" ? w.earnings : w.hours)), 1);
  return items.map((w) => {
    const val = metric === "earnings" ? w.earnings : w.hours;
    const pct = Math.max(4, Math.round((val / maxVal) * 100));
    return {
      short: w.short,
      valueLabel: metric === "earnings" ? currency + fmt2(val) : `${Math.round(val * 10) / 10}h`,
      barStyle: `${pct}%`,
      barColor: w.inProgress ? "var(--color-accent-300)" : "var(--color-accent)",
    };
  });
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function buildMonthlyItems(
  allShifts: Shift[],
  today: Date,
  rate: number,
  count: number,
  allExpenses: DayExpense[] = [],
  allWeekExtras: WeekExtra[] = []
): WeekSummary[] {
  const items: WeekSummary[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const start = isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
    const end = isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const hours = sumHours(shiftsInRange(allShifts, start, end));
    const fuelCost = sumFuelCost(expensesInRange(allExpenses, start, end));
    const extras = sumWeekExtras(weekExtrasInRange(allWeekExtras, start, end));
    items.push({
      startISO: start,
      endISO: end,
      label: MONTH_NAMES[d.getMonth()],
      short: MONTH_NAMES[d.getMonth()].slice(0, 3),
      hours,
      earnings: Math.round((hours * rate + fuelCost + extras) * 100) / 100,
      inProgress: i === 0,
    });
  }
  return items;
}

export function buildYearlyItems(
  allShifts: Shift[],
  today: Date,
  rate: number,
  count: number,
  allExpenses: DayExpense[] = [],
  allWeekExtras: WeekExtra[] = []
): WeekSummary[] {
  const items: WeekSummary[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const year = today.getFullYear() - i;
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const hours = sumHours(shiftsInRange(allShifts, start, end));
    const fuelCost = sumFuelCost(expensesInRange(allExpenses, start, end));
    const extras = sumWeekExtras(weekExtrasInRange(allWeekExtras, start, end));
    items.push({
      startISO: start,
      endISO: end,
      label: i === 0 ? `${year} (YTD)` : String(year),
      short: i === 0 ? `${year} (YTD)` : String(year),
      hours,
      earnings: Math.round((hours * rate + fuelCost + extras) * 100) / 100,
      inProgress: i === 0,
    });
  }
  return items;
}
