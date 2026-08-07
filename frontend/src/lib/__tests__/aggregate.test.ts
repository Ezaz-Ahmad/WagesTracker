import { describe, expect, it } from "vitest";
import { buildDayComputed, buildWeekDaysComputed, weekExtraFor, weekTotals } from "../aggregate";
import type { Shift, WeekExtra } from "../types";

const CURRENCY = "$";

describe("buildDayComputed", () => {
  it("totals multiple shifts logged on the same day", () => {
    const shifts: Shift[] = [
      { id: "1", date: "2026-01-05", location: "Downtown", signIn: "09:00", signOut: "13:00" }, // 4h
      { id: "2", date: "2026-01-05", location: "Uptown", signIn: "14:00", signOut: "18:30" }, // 4.5h
    ];
    const day = buildDayComputed(new Date(2026, 0, 5), shifts, false, CURRENCY, 20);
    expect(day.hours).toBeCloseTo(8.5, 6);
    // 8.5h * $20/h = $170.00
    expect(day.moneyLabel).toBe("$170.00");
  });

  it("adds fuel cost on top of hourly pay for the day, not as a deduction", () => {
    const shifts: Shift[] = [{ id: "1", date: "2026-01-05", location: "", signIn: "09:00", signOut: "17:00" }]; // 8h
    const day = buildDayComputed(new Date(2026, 0, 5), shifts, false, CURRENCY, 20, 15);
    // 8h * $20 + $15 fuel = $175.00
    expect(day.moneyLabel).toBe("$175.00");
  });
});

describe("weekTotals", () => {
  it("totals hours, fuel cost, and hourly wages for the week correctly", () => {
    const monday = new Date(2026, 0, 5); // a Monday
    const shiftsByDate = new Map<string, Shift[]>([
      ["2026-01-05", [{ id: "1", date: "2026-01-05", location: "", signIn: "09:00", signOut: "17:00" }]], // 8h
      [
        "2026-01-06",
        [
          { id: "2", date: "2026-01-06", location: "", signIn: "09:00", signOut: "12:00" }, // 3h
          { id: "3", date: "2026-01-06", location: "", signIn: "13:00", signOut: "17:00" }, // 4h
        ],
      ],
    ]);
    const expensesByDate = new Map<string, number>([["2026-01-05", 15]]);
    const weekDays = [monday, new Date(2026, 0, 6)];
    const days = buildWeekDaysComputed(weekDays, shiftsByDate, monday, CURRENCY, 20, expensesByDate);

    const totals = weekTotals(days, 20);
    expect(totals.hours).toBe(15); // 8 + 3 + 4
    expect(totals.fuelCost).toBe(15);
    expect(totals.daysLogged).toBe(2);
    // 15h * $20 + $15 fuel = $315.00
    expect(totals.earnings).toBe(315);
  });

  it("adds a week's flat 'other earnings' on top of the hourly + fuel total", () => {
    const monday = new Date(2026, 0, 5);
    const shiftsByDate = new Map<string, Shift[]>([
      ["2026-01-05", [{ id: "1", date: "2026-01-05", location: "", signIn: "09:00", signOut: "17:00" }]], // 8h
    ]);
    const days = buildWeekDaysComputed([monday], shiftsByDate, monday, CURRENCY, 20);
    const totals = weekTotals(days, 20); // 8h * $20 = $160

    const weekExtras: WeekExtra[] = [{ weekStart: "2026-01-05", amount: 40, reason: "Holiday tip" }];
    const extra = weekExtraFor("2026-01-05", weekExtras)?.amount ?? 0;

    expect(totals.earnings).toBe(160);
    expect(totals.earnings + extra).toBe(200);
  });

  it("returns all zeros for a week with nothing logged", () => {
    const monday = new Date(2026, 0, 5);
    const days = buildWeekDaysComputed([monday], new Map(), monday, CURRENCY, 20);
    const totals = weekTotals(days, 20);
    expect(totals.hours).toBe(0);
    expect(totals.earnings).toBe(0);
    expect(totals.daysLogged).toBe(0);
  });
});
