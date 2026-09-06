import { describe, expect, it } from "vitest";
import type { Shift } from "../types";
import {
  analyseSmartShiftPatterns,
  buildSmartReminderSchedule,
  formatReminderTime,
} from "../smartShiftReminders";

const AS_OF = new Date(2026, 8, 6, 12); // Sunday, 6 Sep 2026

function shift(
  date: string,
  signIn = "08:00",
  signOut: string | null = "17:00",
  reminderEligible = true,
  id = date
): Shift {
  return { id, date, location: "Central", signIn, signOut, reminderEligible };
}

describe("smart shift pattern learning", () => {
  it("learns a weekday only after four recent, consistently timed completed shifts", () => {
    const patterns = analyseSmartShiftPatterns([
      shift("2026-08-03", "07:55", "16:55"),
      shift("2026-08-10", "08:05", "17:05"),
      shift("2026-08-17", "08:00", "17:00"),
      shift("2026-08-24", "08:10", "17:10"),
      shift("2026-08-31", "08:00", "17:00"),
    ], AS_OF);

    expect(patterns).toEqual([expect.objectContaining({
      weekday: 1,
      weekdayName: "Monday",
      sampleSize: 5,
      usualStartMinutes: 8 * 60,
      usualEndOffsetMinutes: 17 * 60,
    })]);
  });

  it("stays silent with fewer than four usable shifts", () => {
    expect(analyseSmartShiftPatterns([
      shift("2026-08-10"), shift("2026-08-17"), shift("2026-08-24"),
    ], AS_OF)).toEqual([]);
  });

  it("does not turn an alternating or occasional weekday into an every-week assumption", () => {
    expect(analyseSmartShiftPatterns([
      shift("2026-07-20"), shift("2026-08-03"), shift("2026-08-17"), shift("2026-08-31"),
    ], AS_OF)).toEqual([]);
  });

  it("ignores a rare outlier but rejects a broadly unreliable cluster", () => {
    const consistent = [
      shift("2026-08-03", "08:00", "17:00"),
      shift("2026-08-10", "08:05", "17:00"),
      shift("2026-08-17", "07:55", "16:55"),
      shift("2026-08-24", "08:00", "17:05"),
    ];
    expect(analyseSmartShiftPatterns([
      ...consistent,
      shift("2026-08-31", "12:00", "20:00"),
    ], AS_OF)).toHaveLength(1);

    expect(analyseSmartShiftPatterns([
      shift("2026-07-27", "08:00", "17:00"),
      shift("2026-08-03", "08:05", "17:00"),
      shift("2026-08-10", "07:55", "17:05"),
      shift("2026-08-17", "08:00", "16:55"),
      shift("2026-08-24", "12:00", "20:00"),
      shift("2026-08-31", "14:00", "22:00"),
    ], AS_OF)).toEqual([]);
  });

  it("excludes manually corrected and split-shift days", () => {
    const rows = [
      shift("2026-08-03"),
      shift("2026-08-10"),
      shift("2026-08-17"),
      shift("2026-08-24", "08:00", "17:00", false),
      shift("2026-08-31", "08:00", "12:00", true, "split-a"),
      shift("2026-08-31", "13:00", "17:00", true, "split-b"),
    ];
    expect(analyseSmartShiftPatterns(rows, AS_OF)).toEqual([]);
  });

  it("supports consistent overnight routines", () => {
    const pattern = analyseSmartShiftPatterns([
      shift("2026-08-03", "22:00", "06:00"),
      shift("2026-08-10", "22:05", "06:05"),
      shift("2026-08-17", "21:55", "06:00"),
      shift("2026-08-24", "22:00", "05:55"),
      shift("2026-08-31", "22:00", "06:00"),
    ], AS_OF)[0];
    expect(pattern.usualEndOffsetMinutes).toBe(30 * 60);
    expect(formatReminderTime(pattern.usualEndOffsetMinutes)).toBe("6:00 AM");
  });
});

describe("smart reminder scheduling", () => {
  const mondayPattern = {
    weekday: 1,
    weekdayName: "Monday" as const,
    sampleSize: 5,
    usualStartMinutes: 8 * 60,
    usualEndOffsetMinutes: 17 * 60,
    startSpreadMinutes: 10,
    endSpreadMinutes: 10,
  };

  it("uses a grace period and professional personalised sign-in copy", () => {
    const now = new Date(2026, 8, 7, 7, 0); // Monday
    const reminders = buildSmartReminderSchedule({
      accountId: "u1", firstName: "Ezaz", shifts: [], patterns: [mondayPattern], now,
    });
    expect(reminders).toHaveLength(1);
    expect(new Date(reminders[0].fireAtEpochMs).getHours()).toBe(8);
    expect(new Date(reminders[0].fireAtEpochMs).getMinutes()).toBe(20);
    expect(reminders[0]).toMatchObject({
      kind: "signIn",
      usualTimeLabel: "8:00 AM",
      body: "Hi Ezaz, you usually start your Monday shift around 8:00 AM, but no shift has been started today. Did you forget to sign in?",
    });
  });

  it("removes today's sign-in alert and creates one sign-out alert for the active shift", () => {
    const now = new Date(2026, 8, 7, 12, 0);
    const reminders = buildSmartReminderSchedule({
      accountId: "u1",
      firstName: "Ezaz",
      shifts: [shift("2026-09-07", "08:02", null, true, "open")],
      patterns: [mondayPattern],
      now,
    });
    expect(reminders).toEqual([expect.objectContaining({
      id: "signout-open",
      kind: "signOut",
      shiftId: "open",
      usualTimeLabel: "5:00 PM",
      body: "Hi Ezaz, your shift is still active, and you usually finish around 5:00 PM. Did you forget to sign out?",
    })]);
    const fireAt = new Date(reminders[0].fireAtEpochMs);
    expect([fireAt.getHours(), fireAt.getMinutes()]).toEqual([17, 20]);
  });

  it("does not create a stale alert more than four hours after the usual finish", () => {
    const reminders = buildSmartReminderSchedule({
      accountId: "u1",
      firstName: "Ezaz",
      shifts: [shift("2026-09-07", "08:00", null, true, "open")],
      patterns: [mondayPattern],
      now: new Date(2026, 8, 7, 23, 30),
    });
    expect(reminders).toEqual([]);
  });

  it("does not apply the usual finish to a currently unusual start", () => {
    const reminders = buildSmartReminderSchedule({
      accountId: "u1",
      firstName: "Ezaz",
      shifts: [shift("2026-09-07", "14:00", null, true, "cover-shift")],
      patterns: [mondayPattern],
      now: new Date(2026, 8, 7, 15, 0),
    });
    expect(reminders).toEqual([]);
  });
});
