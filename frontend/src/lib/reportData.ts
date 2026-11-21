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
  reportScopeLabel?:string;
  ratesUsed?:number[];
  combinedJobs?:boolean;
  totalWages?:number;
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
  automaticFuelAllowance: number;
  manualFuelOverride: number;
  fuelSourceSummary: string;
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
  const reportDays = days.map((day) => {
    const expenses=dayExpenses.filter(expense=>expense.date===day.dateISO);
    const automatic = expenses.reduce((sum,expense)=>sum+(expense.automaticFuelAllowance ?? (expense.source === "automatic" ? expense.fuelCost : 0)),0);
    const manual = expenses.reduce((sum,expense)=>sum+(expense.manualOverride ?? (expense.source === "manual" ? expense.fuelCost : 0)),0);
    const fuelSource: DayComputed["fuelSource"] = automatic > 0 && manual > 0 ? "mixed" : manual > 0 ? "manual" : automatic > 0 ? "automatic" : null;
    return { ...day, fuelSource };
  });
  const { hours: totalHours, earnings: weekEarnings, daysLogged, fuelCost: totalFuelCost } = weekTotals(reportDays, user.rate);
  const shiftRows = buildShiftRows(reportDays, currency, user.rate);
  const locationBreakdown = buildLocationBreakdown(shiftRows);
  const reportDates = new Set(reportDays.map((day) => day.dateISO));
  const reportExpenses = dayExpenses.filter((expense) => reportDates.has(expense.date));
  const automaticFuelAllowance = Math.round(reportExpenses.reduce((total, expense) => {
    return total + (expense.automaticFuelAllowance ?? (expense.source === "automatic" ? expense.fuelCost : 0));
  }, 0) * 100) / 100;
  const manualFuelOverride = Math.round(reportExpenses.reduce((total, expense) => {
    return total + (expense.manualOverride ?? (expense.source === "manual" ? expense.fuelCost : 0));
  }, 0) * 100) / 100;
  const fuelSourceSummary = automaticFuelAllowance > 0 && manualFuelOverride > 0
    ? "Saved allowances and changed amounts"
    : manualFuelOverride > 0
      ? "Changed amounts"
      : automaticFuelAllowance > 0
        ? "Saved location allowances"
        : "";

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
  const locationCount=new Set(shiftRows.filter(row=>row.hours>0).map(row=>`${row.jobId||""}:${row.workLocationId||row.location.trim().split(/\s+/)[0].toLocaleLowerCase("en-AU")}`)).size;

  return {
    reportScopeLabel:user.workspacesEnabled?user.workLocationName:undefined,
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
    ratesUsed:Array.from(new Set(shiftRows.filter(s=>s.hours>0).map(s=>s.rate??user.rate))).sort((a,b)=>a-b),
    combinedJobs:new Set(shifts.map(s=>s.jobId).filter(Boolean)).size>1,
    totalWages:Math.round(shiftRows.reduce((sum,s)=>sum+Math.round(s.hours*(s.rate??user.rate)*100),0))/100,
    totalHours,
    totalEarnings,
    totalFuelCost,
    totalFuelCostLabel: totalFuelCost > 0 ? currency + fmt2(totalFuelCost) : "—",
    automaticFuelAllowance,
    manualFuelOverride,
    fuelSourceSummary,
    otherEarningAmount,
    otherEarningAmountLabel: otherEarningAmount > 0 ? currency + fmt2(otherEarningAmount) : "—",
    otherEarningReason: weekExtra?.reason ?? "",
    daysLogged,
    locationsCountLabel: `${locationCount || 1} ${locationCount <= 1 ? "location" : "locations"}`,
    days: reportDays,
    shiftRows,
    locationBreakdown,
    multiLocation: user.multipleLocations,
  };
}
