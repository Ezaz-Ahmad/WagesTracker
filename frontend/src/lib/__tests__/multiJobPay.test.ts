import { describe, expect, it } from "vitest";
import {
  buildMonthlyItems,
  buildWeeklyHistory,
  buildYearlyItems,
  groupExpensesByDate,
  weekEarningsFor,
} from "../aggregate";
import { alignExtrasToWeek, resolveShiftRate, sumShiftWages } from "../pay";
import { buildWeekReportData } from "../reportData";
import type {
  DayExpense,
  Job,
  PayRate,
  Shift,
  User,
  WeekExtra,
} from "../types";

const user: User = {
  id: "owner",
  name: "Alex",
  email: "alex@example.com",
  address: "",
  workLocationName: "Employer",
  workAddress: "",
  multipleLocations: true,
  otherLocations: "",
  rate: 99,
  weekStartsOn: "Monday",
  goalHours: 25,
  goalEarnings: 900,
  createdAt: "2026-01-01T00:00:00Z",
};
const job: Job = {
  id: "job-one",
  name: "Employer",
  role: "",
  rate: 99,
  weekStartsOn: "Monday",
  goalHours: 25,
  goalEarnings: 900,
  smartRemindersEnabled: false,
  isPrimary: true,
  archived: false,
  createdAt: user.createdAt,
};
const shifts: Shift[] = [
  {
    id: "1",
    jobId: job.id,
    jobName: job.name,
    date: "2026-11-16",
    workLocationId: "jesmond",
    location: "Jesmond",
    signIn: "08:00",
    signOut: "15:00",
    appliedRate: 30,
  },
  {
    id: "2",
    jobId: job.id,
    jobName: job.name,
    date: "2026-11-17",
    workLocationId: "nelson",
    location: "Nelson Bay",
    signIn: "08:00",
    signOut: "16:00",
    appliedRate: 34,
  },
  {
    id: "3",
    jobId: job.id,
    jobName: job.name,
    date: "2026-11-18",
    workLocationId: "islington",
    location: "Islington",
    signIn: "08:00",
    signOut: "13:00",
    appliedRate: 32,
  },
  {
    id: "4",
    jobId: job.id,
    jobName: job.name,
    date: "2026-11-19",
    workLocationId: "jesmond",
    location: "Jesmond",
    signIn: "08:00",
    signOut: "13:00",
    appliedRate: 30,
  },
];
const fuel: DayExpense[] = shifts.map((shift, index) => ({
  jobId: job.id,
  date: shift.date,
  fuelCost: [10, 15, 5, 10][index],
}));
const extras: WeekExtra[] = [
  {
    jobId: job.id,
    weekStart: "2026-11-16",
    effectiveDate: "2026-11-22",
    amount: 25,
    reason: "Bonus",
  },
];

describe("recorded pay across jobs and locations", () => {
  it("keeps exact half-cent rounding identical in totals and PDF rows", () => {
    const rows: Shift[] = [
      {
        ...shifts[0],
        signIn: "08:00:00",
        signOut: "08:01:48",
        appliedRate: 18.5,
      },
      {
        ...shifts[1],
        signIn: "09:00:00",
        signOut: "10:05:00",
        appliedRate: 30.3,
      },
    ];
    const report = buildWeekReportData(user, rows, new Date(2026, 10, 18), "$");
    expect(report.totalEarnings).toBe(33.39);
    expect(report.totalWages).toBe(33.39);
    expect(report.shiftRows.map((row) => row.moneyLabel)).toEqual([
      "$0.56",
      "$32.83",
    ]);
  });
  it("allocates an extra to its effective month and year across period boundaries", () => {
    const monthExtra: WeekExtra[] = [
      {
        weekStart: "2026-11-30",
        effectiveDate: "2026-12-06",
        amount: 25,
        reason: "Bonus",
      },
    ];
    const months = buildMonthlyItems(
      [],
      new Date(2026, 11, 10),
      30,
      2,
      [],
      monthExtra
    );
    expect(months.map((month) => month.earnings)).toEqual([0, 25]);
    const yearExtra: WeekExtra[] = [
      {
        weekStart: "2026-12-28",
        effectiveDate: "2027-01-03",
        amount: 50,
        reason: "Year-end bonus",
      },
    ];
    expect(
      buildYearlyItems([], new Date(2027, 0, 10), 30, 2, [], yearExtra).map(
        (year) => year.earnings
      )
    ).toEqual([0, 50]);
  });
  it("keeps current, historical, monthly, yearly and PDF totals at the recorded amounts", () => {
    const today = new Date(2026, 10, 23, 12);
    expect(sumShiftWages(shifts, 99)).toBe(792);
    expect(
      weekEarningsFor(new Date(2026, 10, 16), shifts, fuel, extras, 99).earnings
    ).toBe(857);
    expect(
      buildWeeklyHistory(
        shifts,
        today,
        "Monday",
        99,
        1,
        undefined,
        fuel,
        extras
      )[0].earnings
    ).toBe(857);
    expect(
      buildMonthlyItems(shifts, today, 99, 1, fuel, extras).at(-1)?.earnings
    ).toBe(857);
    expect(
      buildYearlyItems(shifts, today, 99, 1, fuel, extras).at(-1)?.earnings
    ).toBe(857);
    const report = buildWeekReportData(user, shifts, today, "$", fuel, extras, {
      weekAnchor: new Date(2026, 10, 16),
    });
    expect(report).toMatchObject({
      totalHours: 25,
      totalWages: 792,
      totalFuelCost: 40,
      otherEarningAmount: 25,
      totalEarnings: 857,
      ratesUsed: [30, 32, 34],
      locationsCountLabel: "3 locations",
    });
    expect(report.days[1].moneyLabel).toBe("$287.00");
    expect(report.shiftRows.map((row) => row.rate)).toEqual([30, 34, 32, 30]);
  });

  it("resolves worked dates, future changes and returning a location to the job default", () => {
    const rates: PayRate[] = [
      {
        id: "base",
        jobId: job.id,
        locationId: null,
        effectiveFrom: "0001-01-01",
        rate: 30,
        createdAt: "",
      },
      {
        id: "local",
        jobId: job.id,
        locationId: "nelson",
        effectiveFrom: "2026-11-17",
        rate: 34,
        createdAt: "",
      },
      {
        id: "future",
        jobId: job.id,
        locationId: null,
        effectiveFrom: "2026-12-01",
        rate: 31,
        createdAt: "",
      },
      {
        id: "inherit",
        jobId: job.id,
        locationId: "nelson",
        effectiveFrom: "2026-12-02",
        rate: null,
        createdAt: "",
      },
      {
        id: "other-owner-job",
        jobId: "other-job",
        locationId: "nelson",
        effectiveFrom: "2026-11-01",
        rate: 100,
        createdAt: "",
      },
    ];
    expect(resolveShiftRate(job, rates, "nelson", "2026-11-16").rate).toBe(30);
    expect(resolveShiftRate(job, rates, "nelson", "2026-11-17").rate).toBe(34);
    expect(resolveShiftRate(job, rates, "nelson", "2026-12-01").rate).toBe(34);
    expect(resolveShiftRate(job, rates, "nelson", "2026-12-02")).toMatchObject({
      rate: 31,
      source: "job",
    });
  });

  it("sums each shift's cents and combines same-day fuel without losing a job", () => {
    const short = shifts.slice(0, 2).map((shift) => ({
      ...shift,
      signIn: "09:00:00",
      signOut: "09:01:00",
      appliedRate: 30.03,
    }));
    expect(sumShiftWages(short, 99)).toBe(1);
    expect(
      groupExpensesByDate([
        { date: "2026-11-18", fuelCost: 10, jobId: "one" },
        { date: "2026-11-18", fuelCost: 15, jobId: "two" },
      ]).get("2026-11-18")
    ).toBe(25);
    const combined = alignExtrasToWeek(
      [
        {
          weekStart: "2026-11-18",
          effectiveDate: "2026-11-24",
          amount: 20,
          reason: "Hotel",
        },
      ],
      "Monday"
    );
    expect(combined[0].weekStart).toBe("2026-11-23");
  });
});
