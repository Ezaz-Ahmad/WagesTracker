import { describe, expect, it } from "vitest";
import { buildWeekDaysComputed, weekTotals } from "../aggregate";
import { buildWeekDays, isoDate } from "../date";
import { buildWeekReportData } from "../reportData";
import type { Shift, User } from "../types";

const CURRENCY = "$";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    name: "Alex Rivera",
    email: "alex@example.com",
    address: "123 Main St",
    workLocationName: "Downtown Store",
    workAddress: "456 Market St",
    multipleLocations: false,
    otherLocations: "",
    weekStartsOn: "Monday",
    rate: 20,
    goalHours: 35,
    goalEarnings: 700,
    createdAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildWeekReportData", () => {
  it("matches the same totals aggregate.ts's own functions produce for identical input", () => {
    const user = makeUser();
    const today = new Date(2026, 0, 5); // a Monday
    const shifts: Shift[] = [
      { id: "1", date: "2026-01-05", location: "Downtown", signIn: "09:00", signOut: "17:00" }, // 8h
      { id: "2", date: "2026-01-06", location: "Downtown", signIn: "09:00", signOut: "13:00" }, // 4h
    ];

    const report = buildWeekReportData(user, shifts, today, CURRENCY, [], []);

    // Independently computed via the same building blocks the report itself
    // uses, so this is a genuine cross-check that the report isn't quietly
    // diverging from what Home/Entry/Report screens actually show.
    const weekDays = buildWeekDays(today, user.weekStartsOn);
    const days = buildWeekDaysComputed(weekDays, new Map([
      ["2026-01-05", [shifts[0]]],
      ["2026-01-06", [shifts[1]]],
    ]), today, CURRENCY, user.rate);
    const expected = weekTotals(days, user.rate);

    expect(report.totalHours).toBe(expected.hours);
    expect(report.totalEarnings).toBe(expected.earnings);
    expect(report.daysLogged).toBe(expected.daysLogged);
  });

  it("includes fuel cost and 'other earnings' in the report's total, on top of hourly wages", () => {
    const user = makeUser();
    const today = new Date(2026, 0, 5);
    const shifts: Shift[] = [{ id: "1", date: "2026-01-05", location: "", signIn: "09:00", signOut: "17:00" }]; // 8h * $20 = $160
    const dayExpenses = [{ date: "2026-01-05", fuelCost: 15 }];
    const weekExtras = [{ weekStart: isoDate(buildWeekDays(today, user.weekStartsOn)[0]), amount: 25, reason: "Tip" }];

    const report = buildWeekReportData(user, shifts, today, CURRENCY, dayExpenses, weekExtras);
    // $160 hourly + $15 fuel + $25 other earnings = $200
    expect(report.totalEarnings).toBe(200);
    expect(report.totalFuelCost).toBe(15);
    expect(report.otherEarningAmount).toBe(25);
    expect(report.otherEarningReason).toBe("Tip");
  });

  it("produces a well-formed, zero-valued report when the user has logged nothing at all", () => {
    const user = makeUser();
    const today = new Date(2026, 0, 5);
    const report = buildWeekReportData(user, [], today, CURRENCY, [], []);
    expect(report.totalHours).toBe(0);
    expect(report.totalEarnings).toBe(0);
    expect(report.daysLogged).toBe(0);
    expect(report.shiftRows).toEqual([]);
    expect(report.locationBreakdown).toEqual([]);
    expect(report.days).toHaveLength(7);
  });

  it("uses the exact Tuesday–Monday range for current and completed-week PDF data", () => {
    const user = makeUser({ weekStartsOn: "Tuesday" });
    const today = new Date(2026, 7, 26); // Wednesday in the Aug 25–31 cycle
    const current = buildWeekReportData(user, [], today, CURRENCY, [], []);
    const completed = buildWeekReportData(user, [], today, CURRENCY, [], [], {
      weekAnchor: new Date(2026, 7, 18),
    });

    expect(current).toMatchObject({
      weekStartISO: "2026-08-25",
      weekEndISO: "2026-08-31",
      weekRangeLabel: "Aug 25 – Aug 31, 2026",
    });
    expect(completed).toMatchObject({
      weekStartISO: "2026-08-18",
      weekEndISO: "2026-08-24",
      weekRangeLabel: "Aug 18 – Aug 24, 2026",
    });
    expect(completed.days.map((day) => day.dateISO)).toEqual([
      "2026-08-18", "2026-08-19", "2026-08-20", "2026-08-21",
      "2026-08-22", "2026-08-23", "2026-08-24",
    ]);
  });

  it("never carries a token, password hash, or admin-only data — only the public report shape", () => {
    const user = makeUser();
    const today = new Date(2026, 0, 5);
    const shifts: Shift[] = [{ id: "1", date: "2026-01-05", location: "Downtown", signIn: "09:00", signOut: "17:00" }];
    const report = buildWeekReportData(user, shifts, today, CURRENCY, [], []);

    // Belt-and-suspenders on top of the type system (User has no such fields
    // to begin with): a runtime guard so a future change loosening that type
    // can't silently leak something sensitive into a PDF/report.
    const serialized = JSON.stringify(report).toLowerCase();
    for (const forbidden of ["token", "password", "admin", "hash"]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
