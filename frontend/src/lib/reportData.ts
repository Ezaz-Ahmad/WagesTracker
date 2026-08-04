import {
  buildLocationBreakdown,
  buildShiftRows,
  buildWeekDaysComputed,
  groupByDate,
  weekTotals,
  type DayComputed,
  type LocationBreakdown,
  type ShiftRow,
} from "./aggregate";
import { buildWeekDays, fmt2, weekRangeLabel } from "./date";
import type { Shift, User } from "./types";

export interface WeekReportData {
  weekRangeLabel: string;
  generatedOnLabel: string;
  employeeName: string;
  employeeInitials: string;
  workLocationName: string;
  workAddress: string;
  currency: string;
  rate: number;
  totalHours: number;
  totalEarnings: number;
  daysLogged: number;
  avgHoursPerDayLabel: string;
  avgEarningsPerDayLabel: string;
  locationsCountLabel: string;
  days: DayComputed[];
  shiftRows: ShiftRow[];
  locationBreakdown: LocationBreakdown[];
  multiLocation: boolean;
}

export function buildWeekReportData(user: User, shifts: Shift[], today: Date, currency: string): WeekReportData {
  const weekDays = buildWeekDays(today, user.weekStartsOn);
  const shiftsByDate = groupByDate(shifts);
  const days = buildWeekDaysComputed(weekDays, shiftsByDate, today, currency, user.rate);
  const { hours: totalHours, earnings: totalEarnings, daysLogged } = weekTotals(days, user.rate);
  const shiftRows = buildShiftRows(days, currency, user.rate);
  const locationBreakdown = buildLocationBreakdown(shiftRows);

  const initials =
    (user.name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] || "")
      .join("")
      .toUpperCase() || "—";

  return {
    weekRangeLabel: weekRangeLabel(weekDays[0], weekDays[6]),
    generatedOnLabel: today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    employeeName: user.name,
    employeeInitials: initials,
    workLocationName: user.workLocationName,
    workAddress: user.workAddress,
    currency,
    rate: user.rate,
    totalHours,
    totalEarnings,
    daysLogged,
    avgHoursPerDayLabel: daysLogged > 0 ? `${Math.round((totalHours / daysLogged) * 10) / 10}h` : "—",
    avgEarningsPerDayLabel: daysLogged > 0 ? currency + fmt2(totalEarnings / daysLogged) : "—",
    locationsCountLabel: `${locationBreakdown.length || 1} ${locationBreakdown.length === 1 ? "location" : "locations"}`,
    days,
    shiftRows,
    locationBreakdown,
    multiLocation: user.multipleLocations,
  };
}
