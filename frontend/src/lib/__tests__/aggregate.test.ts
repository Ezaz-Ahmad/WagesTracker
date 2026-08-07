import { describe, expect, it } from "vitest";
import { buildDayComputed, buildWeekDaysComputed, weekExtraFor, weekTotals } from "../aggregate";
import { isoDate, startOfWeek } from "../date";
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

  it("rounds earnings to exactly two decimal places even with a repeating-decimal intermediate result", () => {
    const shifts: Shift[] = [{ id: "1", date: "2026-01-05", location: "", signIn: "09:00:00", signOut: "09:20:00" }]; // exactly 1/3 hour
    const day = buildDayComputed(new Date(2026, 0, 5), shifts, false, CURRENCY, 17.75);
    // 1/3 * $17.75 = $5.9166... -> must round to exactly $5.92, never a longer decimal.
    expect(day.moneyLabel).toBe("$5.92");
  });

  it("attributes an overnight shift's full duration to its starting date, not the day it technically ends on", () => {
    const shifts: Shift[] = [{ id: "1", date: "2026-01-05", location: "", signIn: "22:00", signOut: "06:00" }]; // 8h, crosses midnight
    const day = buildDayComputed(new Date(2026, 0, 5), shifts, false, CURRENCY, 20);
    // All 8 hours land on the 5th (the starting date) — there's no separate
    // end-date field, and the following day (the 6th) gets none of it; see
    // buildWeekDaysComputed's own test below for that half of the guarantee.
    expect(day.hours).toBe(8);
    expect(day.moneyLabel).toBe("$160.00");
  });

  it("does not count an active (still clocked-in) shift's hours in the saved total", () => {
    const shifts: Shift[] = [
      { id: "1", date: "2026-01-05", location: "", signIn: "09:00", signOut: "13:00" }, // 4h, completed
      { id: "2", date: "2026-01-05", location: "", signIn: "14:00", signOut: null }, // still open
    ];
    const day = buildDayComputed(new Date(2026, 0, 5), shifts, false, CURRENCY, 20);
    // Only the completed shift counts here — an open shift's hours are meant
    // to be added on top separately and live (see useLiveElapsedHours), never
    // baked into this saved total, or the UI would double-count them.
    expect(day.hours).toBe(4);
  });
});

describe("startOfWeek (week boundaries)", () => {
  it("assigns a Sunday to the week that ends on it, not the week the following Monday starts", () => {
    // Verify these actually are a Sunday/Monday pair rather than assuming —
    // the test's correctness shouldn't depend on knowing calendar trivia.
    const sunday = new Date(2026, 0, 4);
    expect(sunday.getDay()).toBe(0);
    const monday = new Date(2026, 0, 5);
    expect(monday.getDay()).toBe(1);

    const sundaysWeek = startOfWeek(sunday, "Monday");
    const mondaysWeek = startOfWeek(monday, "Monday");
    // The Monday starts its own (new) week...
    expect(isoDate(mondaysWeek)).toBe(isoDate(monday));
    // ...while the Sunday belongs to the *previous* Monday-starting week, not
    // the same week as the Monday that comes right after it.
    expect(isoDate(sundaysWeek)).not.toBe(isoDate(mondaysWeek));
  });

  it("respects the week-start preference — the same date lands in a different week's start under Sunday-start vs Monday-start", () => {
    const wednesday = new Date(2026, 0, 7);
    expect(wednesday.getDay()).toBe(3);

    const weekStartMonday = startOfWeek(wednesday, "Monday");
    const weekStartSunday = startOfWeek(wednesday, "Sunday");
    expect(weekStartMonday.getDay()).toBe(1);
    expect(weekStartSunday.getDay()).toBe(0);
    // Different preferences must not coincidentally agree on the same start date.
    expect(isoDate(weekStartMonday)).not.toBe(isoDate(weekStartSunday));
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

  it("bakes fuel cost into weekTotals.earnings but leaves 'other earnings' for the caller to add on separately", () => {
    const monday = new Date(2026, 0, 5);
    const shiftsByDate = new Map<string, Shift[]>([
      ["2026-01-05", [{ id: "1", date: "2026-01-05", location: "", signIn: "09:00", signOut: "17:00" }]], // 8h
    ]);
    const expensesByDate = new Map([["2026-01-05", 15]]);
    const days = buildWeekDaysComputed([monday], shiftsByDate, monday, CURRENCY, 20, expensesByDate);
    const totals = weekTotals(days, 20);
    // 8h * $20 + $15 fuel = $175 — fuel cost is baked directly into weekTotals.
    expect(totals.earnings).toBe(175);

    const weekExtras: WeekExtra[] = [{ weekStart: "2026-01-05", amount: 50, reason: "Bonus" }];
    const otherAmount = weekExtraFor("2026-01-05", weekExtras)?.amount ?? 0;
    // "Other earnings" is intentionally NOT part of weekTotals — every screen
    // that shows a grand total adds it on top itself (see HomeScreen/
    // EntryScreen/ReportScreen: `savedEarnings = weekEarnings + otherAmount`).
    // weekTotals not knowing about it is the rule, not a gap.
    expect(totals.earnings).toBe(175);
    expect(totals.earnings + otherAmount).toBe(225);
  });

  it("gives the day after an overnight shift zero hours from it — nothing carries over past midnight", () => {
    const monday = new Date(2026, 0, 5);
    const tuesday = new Date(2026, 0, 6);
    // Filed entirely under the 5th (its `date`), even though 22:00->06:00
    // technically runs into the 6th on the clock.
    const shiftsByDate = new Map<string, Shift[]>([
      ["2026-01-05", [{ id: "1", date: "2026-01-05", location: "", signIn: "22:00", signOut: "06:00" }]], // 8h
    ]);
    const days = buildWeekDaysComputed([monday, tuesday], shiftsByDate, monday, CURRENCY, 20);
    const [mon, tue] = days;
    expect(mon.hours).toBe(8);
    expect(tue.hours).toBe(0); // the 6th has no shift record of its own, so it gets none of the 5th's hours
    expect(weekTotals(days, 20).hours).toBe(8); // and the week total isn't double-counting it either
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
