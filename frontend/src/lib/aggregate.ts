import { addDays, computeHours, dayAbbr, fmt2, isoDate, shortLabel, startOfWeek } from "./date";
import type { Shift, WeekStart } from "./types";

export interface ShiftComputed {
  id: string | null;
  shiftIndex: number;
  location: string;
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
}

export interface WeekSummary {
  startISO: string;
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

export function groupByDate(shifts: Shift[]): Map<string, Shift[]> {
  const map = new Map<string, Shift[]>();
  for (const s of shifts) {
    const list = map.get(s.date) ?? [];
    list.push(s);
    map.set(s.date, list);
  }
  return map;
}

export function buildDayComputed(
  date: Date,
  shiftsForDate: Shift[],
  isToday: boolean,
  currency: string,
  rate: number
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
      signIn: sh.signIn,
      signOut: sh.signOut,
      hours,
      hoursLabel: hours > 0 ? `${hours}h` : "—",
      canRemove: raw.length > 1,
    };
  });
  const hours = Math.round(shifts.reduce((a, s) => a + s.hours, 0) * 100) / 100;
  return {
    dateISO: isoDate(date),
    dayAbbr: dayAbbr(date),
    dateLabel: shortLabel(date),
    isToday,
    shifts,
    hours,
    hoursLabel: hours > 0 ? `${hours}h` : "—",
    moneyLabel: hours > 0 ? currency + fmt2(hours * rate) : "—",
  };
}

export function buildWeekDaysComputed(
  weekDays: Date[],
  shiftsByDate: Map<string, Shift[]>,
  today: Date,
  currency: string,
  rate: number
): DayComputed[] {
  return weekDays.map((d) => {
    const key = isoDate(d);
    const isToday = key === isoDate(today);
    return buildDayComputed(d, shiftsByDate.get(key) ?? [], isToday, currency, rate);
  });
}

export function weekTotals(days: DayComputed[], rate: number): { hours: number; earnings: number; daysLogged: number } {
  const hours = Math.round(days.reduce((a, d) => a + d.hours, 0) * 100) / 100;
  return { hours, earnings: Math.round(hours * rate * 100) / 100, daysLogged: days.filter((d) => d.hours > 0).length };
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
        signIn: sh.signIn || "—",
        signOut: sh.signOut || "—",
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
    hours: Math.round(v.hours * 100) / 100,
    hoursLabel: `${Math.round(v.hours * 100) / 100}h`,
    moneyLabel: `$${v.earnings.toFixed(2)}`,
  }));
}

function shiftsInRange(shifts: Shift[], startISO: string, endISO: string): Shift[] {
  return shifts.filter((s) => s.date >= startISO && s.date <= endISO);
}

function sumHours(shifts: Shift[]): number {
  return Math.round(shifts.reduce((a, s) => a + computeHours(s.signIn, s.signOut), 0) * 100) / 100;
}

/** Completed weeks strictly before the week containing `today`, oldest first. */
export function buildWeeklyHistory(
  allShifts: Shift[],
  today: Date,
  weekStartsOn: WeekStart,
  rate: number,
  count: number
): WeekSummary[] {
  const currentWeekStart = startOfWeek(today, weekStartsOn);
  const weeks: WeekSummary[] = [];
  for (let i = count; i >= 1; i--) {
    const start = addDays(currentWeekStart, -7 * i);
    const end = addDays(start, 6);
    const hours = sumHours(shiftsInRange(allShifts, isoDate(start), isoDate(end)));
    weeks.push({
      startISO: isoDate(start),
      label: `${shortLabel(start)} – ${end.getMonth() === start.getMonth() ? end.getDate() : shortLabel(end)}`,
      short: shortLabel(start),
      hours,
      earnings: Math.round(hours * rate * 100) / 100,
    });
  }
  return weeks;
}

export interface ChartPoint {
  x: number;
  y: number;
  labelY: number;
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
  return [...history, { startISO: "current", label: "This week", short: "Now", hours: currentHours, earnings: currentEarnings, inProgress: true }];
}

export function buildChart(chartSource: WeekSummary[], metric: "earnings" | "hours", currency: string) {
  const maxVal = Math.max(...chartSource.map((w) => (metric === "earnings" ? w.earnings : w.hours)), 1);
  const chartW = 320;
  const chartH = 118;
  const n = chartSource.length;
  const points: ChartPoint[] = chartSource.map((w, i) => {
    const val = metric === "earnings" ? w.earnings : w.hours;
    const x = n > 1 ? Math.round((i * chartW) / (n - 1)) : chartW / 2;
    const y = Math.round(chartH - Math.max(6, (val / maxVal) * (chartH - 16)));
    return {
      x,
      y,
      labelY: Math.max(10, y - 10),
      short: w.short,
      valueLabel: metric === "earnings" ? currency + Math.round(val) : `${val}h`,
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
      valueLabel: metric === "earnings" ? currency + Math.round(val) : `${val}h`,
      barStyle: `${pct}%`,
      barColor: w.inProgress ? "var(--color-accent-300)" : "var(--color-accent)",
    };
  });
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function buildMonthlyItems(allShifts: Shift[], today: Date, rate: number, count: number): WeekSummary[] {
  const items: WeekSummary[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const start = isoDate(new Date(d.getFullYear(), d.getMonth(), 1));
    const end = isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    const hours = sumHours(shiftsInRange(allShifts, start, end));
    items.push({
      startISO: start,
      label: MONTH_NAMES[d.getMonth()],
      short: MONTH_NAMES[d.getMonth()].slice(0, 3),
      hours,
      earnings: Math.round(hours * rate * 100) / 100,
      inProgress: i === 0,
    });
  }
  return items;
}

export function buildYearlyItems(allShifts: Shift[], today: Date, rate: number, count: number): WeekSummary[] {
  const items: WeekSummary[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const year = today.getFullYear() - i;
    const start = `${year}-01-01`;
    const end = `${year}-12-31`;
    const hours = sumHours(shiftsInRange(allShifts, start, end));
    items.push({
      startISO: start,
      label: i === 0 ? `${year} (YTD)` : String(year),
      short: i === 0 ? `${year} (YTD)` : String(year),
      hours,
      earnings: Math.round(hours * rate * 100) / 100,
      inProgress: i === 0,
    });
  }
  return items;
}
