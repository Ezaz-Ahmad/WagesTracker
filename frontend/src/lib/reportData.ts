import {
  buildLocationBreakdown,
  buildShiftRows,
  buildWeekDaysComputed,
  groupByDate,
  groupExpensesByDate,
  weekExtraFor,
  weekTotals,
  type DayComputed,
  type LocationBreakdown,
  type ShiftRow,
} from "./aggregate";
import { buildWeekDays, fmt2, isoDate, weekRangeLabel } from "./date";
import type { DayExpense, Shift, User, WeekExtra } from "./types";

export interface WeekReportData {
  /** First and last day of the week this report covers, ISO. Carried on the
   * data rather than recomputed at save time so the filename can never
   * disagree with the contents — the two are built from one source. */
  weekStartISO: string;
  weekEndISO: string;
  weekRangeLabel: string;
  generatedOnLabel: string;
  employeeName: string;
  employeeInitials: string;
  employeeAddress: string;
  workLocationName: string;
  workAddress: string;
  currency: string;
  rate: number;
  totalHours: number;
  totalEarnings: number;
  totalFuelCost: number;
  totalFuelCostLabel: string;
  otherEarningAmount: number;
  otherEarningAmountLabel: string;
  otherEarningReason: string;
  daysLogged: number;
  locationsCountLabel: string;
  days: DayComputed[];
  shiftRows: ShiftRow[];
  locationBreakdown: LocationBreakdown[];
  multiLocation: boolean;
}

export interface BuildWeekReportOptions {
  /** Any date inside the week to report on. Defaults to `today`, i.e. the
   * current week. History passes the target week's start date. */
  weekAnchor?: Date;
}

export function buildWeekReportData(
  user: User,
  shifts: Shift[],
  today: Date,
  currency: string,
  dayExpenses: DayExpense[] = [],
  weekExtras: WeekExtra[] = [],
  options: BuildWeekReportOptions = {}
): WeekReportData {
  // `today` used to do three unrelated jobs at once: pick the week, decide
  // which day is "today" for the day-strip highlight, and stamp the
  // generated-on date. That was fine while the only caller reported the
  // current week, but downloading a past week by passing a past date as
  // `today` would also have back-dated the "Generated" line — claiming the
  // document was produced weeks ago.
  //
  // `weekAnchor` now selects the week and nothing else. `today` keeps the
  // other two jobs, which are both genuinely about now: the report is
  // generated now, and for a past week no day matches today, so nothing is
  // highlighted — which is correct.
  const weekAnchor = options.weekAnchor ?? today;
  const weekDays = buildWeekDays(weekAnchor, user.weekStartsOn);
  const shiftsByDate = groupByDate(shifts);
  const expensesByDate = groupExpensesByDate(dayExpenses);
  const days = buildWeekDaysComputed(weekDays, shiftsByDate, today, currency, user.rate, expensesByDate);
  const { hours: totalHours, earnings: weekEarnings, daysLogged, fuelCost: totalFuelCost } = weekTotals(days, user.rate);
  const shiftRows = buildShiftRows(days, currency, user.rate);
  const locationBreakdown = buildLocationBreakdown(shiftRows);

  const weekExtra = weekExtraFor(isoDate(weekDays[0]), weekExtras);
  const otherEarningAmount = weekExtra?.amount ?? 0;
  const totalEarnings = Math.round((weekEarnings + otherEarningAmount) * 100) / 100;

  const initials =
    (user.name || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] || "")
      .join("")
      .toUpperCase() || "—";

  return {
    weekStartISO: isoDate(weekDays[0]),
    weekEndISO: isoDate(weekDays[6]),
    weekRangeLabel: weekRangeLabel(weekDays[0], weekDays[6]),
    generatedOnLabel: today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    employeeName: user.name,
    employeeInitials: initials,
    employeeAddress: user.address,
    workLocationName: user.workLocationName,
    workAddress: user.workAddress,
    currency,
    rate: user.rate,
    totalHours,
    totalEarnings,
    totalFuelCost,
    totalFuelCostLabel: totalFuelCost > 0 ? currency + fmt2(totalFuelCost) : "—",
    otherEarningAmount,
    otherEarningAmountLabel: otherEarningAmount > 0 ? currency + fmt2(otherEarningAmount) : "—",
    otherEarningReason: weekExtra?.reason ?? "",
    daysLogged,
    locationsCountLabel: `${locationBreakdown.length || 1} ${locationBreakdown.length === 1 ? "location" : "locations"}`,
    days,
    shiftRows,
    locationBreakdown,
    multiLocation: user.multipleLocations,
  };
}
