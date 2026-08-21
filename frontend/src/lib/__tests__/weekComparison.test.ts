import { describe, expect, it } from "vitest";
import { compareWeekEarnings, type WeekComparisonInput } from "../weekComparison";
import type { DayExpense, Shift, WeekExtra } from "../types";

/**
 * The "vs prior week" figure on Home.
 *
 * The bug these guard against was visible on a real account as a permanent
 * red "▲ 0% vs prior week": the old expression compared the two most recent
 * *completed* weeks (never the current one), collapsed "no prior data" into
 * `0`, treated `0` as an increase, and excluded the live shift that the
 * headline right next to it included. Each of those is pinned below.
 */

// A Wednesday, so week-start handling has something to actually get wrong.
const TODAY = new Date(2026, 7, 12); // 12 Aug 2026

/** 4h shift on the given date — 4 × rate, with rate 25 that's $100. */
function shift(date: string, hours = 4): Shift {
  const end = 9 + hours;
  return {
    id: `s-${date}-${hours}`,
    date,
    location: "",
    signIn: "09:00",
    signOut: `${String(end).padStart(2, "0")}:00`,
  };
}

function base(overrides: Partial<WeekComparisonInput> = {}): WeekComparisonInput {
  return {
    today: TODAY,
    weekStartsOn: "Monday",
    shifts: [],
    dayExpenses: [],
    weekExtras: [],
    rate: 25,
    ...overrides,
  };
}

// Monday-start weeks around TODAY: current = 10–16 Aug, previous = 3–9 Aug.
const THIS_WEEK = "2026-08-12";
const LAST_WEEK = "2026-08-05";

describe("direction and magnitude", () => {
  it("reports an increase", () => {
    // 12h this week = $300; 10h last week = $250. +20%.
    const result = compareWeekEarnings(
      base({ shifts: [shift(THIS_WEEK, 12), shift(LAST_WEEK, 10)] })
    );
    expect(result.status).toBe("up");
    expect(result.percentChange).toBe(20);
    expect(result.direction).toBe("up");
    expect(result.label).toBe("20% vs prior week");
  });

  it("reports a decrease", () => {
    // 8h = $200 against 10h = $250. -20%.
    const result = compareWeekEarnings(
      base({ shifts: [shift(THIS_WEEK, 8), shift(LAST_WEEK, 10)] })
    );
    expect(result.status).toBe("down");
    expect(result.percentChange).toBe(-20);
    expect(result.direction).toBe("down");
    expect(result.label).toBe("20% vs prior week");
  });

  it("reports equal weeks as no change, with no arrow", () => {
    const result = compareWeekEarnings(
      base({ shifts: [shift(THIS_WEEK, 10), shift(LAST_WEEK, 10)] })
    );
    expect(result.status).toBe("no-change");
    expect(result.direction).toBe("none");
    expect(result.label).toBe("No change vs prior week");
  });

  it("never renders an upward arrow on a zero result", () => {
    // The exact reported symptom. Every status that can produce a 0 (or no)
    // percentage must be directionless.
    const zeroish = [
      compareWeekEarnings(base({ shifts: [shift(THIS_WEEK, 10), shift(LAST_WEEK, 10)] })),
      compareWeekEarnings(base()),
      compareWeekEarnings(base({ shifts: [shift(THIS_WEEK, 10)] })),
    ];
    for (const result of zeroish) {
      if (result.percentChange === 0 || result.percentChange === null) {
        expect(result.direction).not.toBe("up");
      }
    }
  });

  it("does not present a sub-1% difference as a directional zero", () => {
    // $250.00 vs $250.50 rounds to 0% — showing "▲ 0%" here is the bug.
    const result = compareWeekEarnings(
      base({
        shifts: [shift(THIS_WEEK, 10), shift(LAST_WEEK, 10)],
        dayExpenses: [{ date: THIS_WEEK, fuelCost: 0.5 }],
      })
    );
    expect(result.status).toBe("negligible");
    expect(result.direction).toBe("none");
    expect(result.label).toBe("About the same as prior week");
  });
});

describe("edge cases that used to collapse into 0%", () => {
  it("distinguishes no prior-week records from a flat week", () => {
    const result = compareWeekEarnings(base({ shifts: [shift(THIS_WEEK, 10)] }));
    expect(result.status).toBe("no-prior-data");
    expect(result.percentChange).toBeNull();
    expect(result.previousTotal).toBeNull();
    expect(result.direction).toBe("none");
    expect(result.label).toBe("No prior-week data");
  });

  it("says New this week when the prior week logged time but earned nothing", () => {
    // A prior-week record exists (a 0-hour shift), so it isn't "no data" —
    // but dividing by its zero total would be Infinity.
    const result = compareWeekEarnings(
      base({ shifts: [shift(THIS_WEEK, 10), shift(LAST_WEEK, 0)] })
    );
    expect(result.status).toBe("new-this-week");
    expect(result.percentChange).toBeNull();
    expect(result.label).toBe("New this week");
  });

  it("stays neutral when neither week has earnings", () => {
    const result = compareWeekEarnings(base());
    expect(result.status).toBe("no-activity");
    expect(result.direction).toBe("none");
    expect(result.percentChange).toBeNull();
  });

  it("never produces Infinity or NaN in any of the above", () => {
    const inputs = [
      base(),
      base({ shifts: [shift(THIS_WEEK, 10)] }),
      base({ shifts: [shift(THIS_WEEK, 10), shift(LAST_WEEK, 0)] }),
      base({ shifts: [shift(LAST_WEEK, 10)] }),
    ];
    for (const input of inputs) {
      const { percentChange } = compareWeekEarnings(input);
      if (percentChange !== null) expect(Number.isFinite(percentChange)).toBe(true);
    }
  });

  it("handles this week dropping to nothing against a real prior week", () => {
    const result = compareWeekEarnings(base({ shifts: [shift(LAST_WEEK, 10)] }));
    expect(result.status).toBe("down");
    expect(result.percentChange).toBe(-100);
  });
});

describe("it counts exactly what the headline counts", () => {
  it("includes fuel reimbursement in both weeks", () => {
    const withFuel = compareWeekEarnings(
      base({
        shifts: [shift(THIS_WEEK, 10), shift(LAST_WEEK, 10)],
        dayExpenses: [{ date: THIS_WEEK, fuelCost: 50 }],
      })
    );
    // $300 vs $250 — the fuel is what makes it a 20% rise, so it is
    // demonstrably part of the total rather than ignored.
    expect(withFuel.currentTotal).toBe(300);
    expect(withFuel.previousTotal).toBe(250);
    expect(withFuel.percentChange).toBe(20);
  });

  it("includes other earnings in both weeks", () => {
    const extras: WeekExtra[] = [
      { weekStart: "2026-08-10", amount: 50, reason: "tip" },
      { weekStart: "2026-08-03", amount: 100, reason: "bonus" },
    ];
    const result = compareWeekEarnings(
      base({ shifts: [shift(THIS_WEEK, 10), shift(LAST_WEEK, 10)], weekExtras: extras })
    );
    expect(result.currentTotal).toBe(300); // 250 + 50
    expect(result.previousTotal).toBe(350); // 250 + 100
    expect(result.status).toBe("down");
  });

  it("adds the in-progress shift and flags the result as an estimate", () => {
    const settled = compareWeekEarnings(
      base({ shifts: [shift(THIS_WEEK, 10), shift(LAST_WEEK, 10)] })
    );
    expect(settled.isEstimate).toBe(false);

    // Two live hours at $25 — the same figure the headline adds.
    const live = compareWeekEarnings(
      base({ shifts: [shift(THIS_WEEK, 10), shift(LAST_WEEK, 10)], liveEarnings: 50 })
    );
    expect(live.isEstimate).toBe(true);
    expect(live.currentTotal).toBe(300);
    expect(live.percentChange).toBe(20);
  });

  it("tracks the hourly rate", () => {
    const shifts: Shift[] = [shift(THIS_WEEK, 12), shift(LAST_WEEK, 10)];
    // The ratio is rate-independent, but the totals must scale with it —
    // proving the rate is genuinely applied rather than baked in anywhere.
    expect(compareWeekEarnings(base({ shifts, rate: 25 })).currentTotal).toBe(300);
    expect(compareWeekEarnings(base({ shifts, rate: 50 })).currentTotal).toBe(600);
  });
});

describe("week boundaries", () => {
  it("follows the user's week-start preference", () => {
    // 9 Aug 2026 is a Sunday. Monday-start puts it in the *previous* week;
    // Sunday-start puts it in the current one — so the same data has to
    // produce different comparisons.
    const shifts: Shift[] = [shift("2026-08-09", 10), shift("2026-08-12", 10)];

    const mondayStart = compareWeekEarnings(base({ shifts, weekStartsOn: "Monday" }));
    expect(mondayStart.currentTotal).toBe(250);
    expect(mondayStart.previousTotal).toBe(250);

    // Sunday-start pulls the 9th into the current week, so both shifts land
    // there and the week before it holds no records at all.
    const sundayStart = compareWeekEarnings(base({ shifts, weekStartsOn: "Sunday" }));
    expect(sundayStart.currentTotal).toBe(500);
    expect(sundayStart.previousTotal).toBeNull();
    expect(sundayStart.status).toBe("no-prior-data");
  });

  it("moves the comparison window when the local date rolls into a new week", () => {
    const shifts: Shift[] = [shift("2026-08-12", 10)];

    // Wednesday: that shift is this week, nothing prior.
    const during = compareWeekEarnings(base({ today: new Date(2026, 7, 12), shifts }));
    expect(during.currentTotal).toBe(250);
    expect(during.status).toBe("no-prior-data");

    // The following Monday: the same shift is now the *prior* week.
    const after = compareWeekEarnings(base({ today: new Date(2026, 7, 17), shifts }));
    expect(after.currentTotal).toBe(0);
    expect(after.previousTotal).toBe(250);
    expect(after.status).toBe("down");
  });

  it("compares the exact current and previous Tuesday–Monday cycles", () => {
    const result = compareWeekEarnings(base({
      weekStartsOn: "Tuesday",
      shifts: [
        shift("2026-08-10", 4), // previous Tuesday 4 -> Monday 10
        shift("2026-08-11", 8), // current Tuesday 11 -> Monday 17
      ],
    }));

    expect(result.currentTotal).toBe(200);
    expect(result.previousTotal).toBe(100);
    expect(result.percentChange).toBe(100);
  });
});

describe("recalculation after data changes", () => {
  // Pure function, so "recomputes on mutation" means: same call, changed
  // inputs, changed answer. HomeScreen derives it during render from context
  // state, so every one of these corresponds to a real user action.
  const start: Shift[] = [shift(THIS_WEEK, 10), shift(LAST_WEEK, 10)];

  it("reacts to a shift being added, edited and deleted", () => {
    expect(compareWeekEarnings(base({ shifts: start })).status).toBe("no-change");

    const added = [...start, shift("2026-08-13", 2)];
    expect(compareWeekEarnings(base({ shifts: added })).status).toBe("up");

    const edited = [shift(THIS_WEEK, 4), start[1]];
    expect(compareWeekEarnings(base({ shifts: edited })).status).toBe("down");

    const deleted = [start[1]];
    expect(compareWeekEarnings(base({ shifts: deleted })).percentChange).toBe(-100);
  });

  it("reacts to a fuel-cost change", () => {
    const before = compareWeekEarnings(base({ shifts: start }));
    const after = compareWeekEarnings(
      base({ shifts: start, dayExpenses: [{ date: THIS_WEEK, fuelCost: 25 }] as DayExpense[] })
    );
    expect(before.status).toBe("no-change");
    expect(after.status).toBe("up");
    expect(after.percentChange).toBe(10);
  });

  it("reacts to an other-earnings change", () => {
    const after = compareWeekEarnings(
      base({
        shifts: start,
        weekExtras: [{ weekStart: "2026-08-10", amount: 25, reason: "tip" }],
      })
    );
    expect(after.status).toBe("up");
    expect(after.percentChange).toBe(10);
  });

  it("reacts to signing out of a live shift, without the total jumping", () => {
    // Mid-shift: 2 live hours on top of the settled week.
    const live = compareWeekEarnings(base({ shifts: start, liveEarnings: 50 }));
    expect(live.currentTotal).toBe(300);
    expect(live.isEstimate).toBe(true);

    // Signed out: those hours are now a stored 2h shift and the live figure
    // is gone. Same total — no visible jump, which is the point of feeding
    // the live number through the same path.
    const signedOut = compareWeekEarnings(
      base({ shifts: [...start, shift("2026-08-12", 2)], liveEarnings: 0 })
    );
    expect(signedOut.currentTotal).toBe(300);
    expect(signedOut.isEstimate).toBe(false);
  });
});
