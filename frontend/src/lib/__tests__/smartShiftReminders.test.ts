import { describe, expect, it } from "vitest";
import type { Shift } from "../types";
import {
  analyseSmartShiftPatterns,
  buildSmartReminderSchedule,
  formatReminderTime,
  getSmartShiftLearningProgress,
} from "../smartShiftReminders";

const AS_OF = new Date(2026, 8, 6, 12); // Sunday, 6 Sep 2026

function shift(
  date: string,
  signIn = "08:00",
  signOut: string | null = "17:00",
  id = date
): Shift {
  return { id, date, location: "Central", signIn, signOut };
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
      sampleSize: 4,
      usualStartMinutes: 8 * 60 + 5,
      usualEndOffsetMinutes: 17 * 60 + 5,
    })]);
  });

  it("stays silent with fewer than four usable shifts", () => {
    expect(analyseSmartShiftPatterns([
      shift("2026-08-10"), shift("2026-08-17"), shift("2026-08-24"),
    ], AS_OF)).toEqual([]);
  });

  it("does not turn an alternating weekday into an every-week assumption", () => {
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

  it("learns from completed historical entries even when their exact minutes were edited", () => {
    expect(analyseSmartShiftPatterns([
      shift("2026-08-03"),
      shift("2026-08-10", "08:03", "17:02"),
      shift("2026-08-17", "07:58", "16:59"),
      shift("2026-08-24", "08:01", "17:04"),
      shift("2026-08-31", "08:00", "17:00"),
    ], AS_OF)).toHaveLength(1);
  });

  it("still excludes an ambiguous split-shift day", () => {
    const rows = [
      shift("2026-08-03"), shift("2026-08-10"), shift("2026-08-17"),
      shift("2026-08-24", "08:00", "12:00", "split-a"),
      shift("2026-08-24", "13:00", "17:00", "split-b"),
    ];
    expect(analyseSmartShiftPatterns(rows, AS_OF)).toEqual([]);
  });

  it("adopts a materially changed roster after four new consistent shifts", () => {
    const oldRoutine = [
      shift("2026-06-08", "08:00", "17:00"), shift("2026-06-15", "08:00", "17:00"),
      shift("2026-06-22", "08:00", "17:00"), shift("2026-06-29", "08:00", "17:00"),
      shift("2026-07-06", "08:00", "17:00"), shift("2026-07-13", "08:00", "17:00"),
    ];
    const changedRoutine = [
      shift("2026-08-10", "10:00", "18:00"), shift("2026-08-17", "10:05", "18:05"),
      shift("2026-08-24", "09:55", "17:55"), shift("2026-08-31", "10:00", "18:00"),
    ];
    expect(analyseSmartShiftPatterns([...oldRoutine, ...changedRoutine], AS_OF)).toEqual([
      expect.objectContaining({
        weekdayName: "Monday",
        sampleSize: 4,
        usualStartMinutes: 10 * 60,
        usualEndOffsetMinutes: 18 * 60,
      }),
    ]);
  });

  it("tracks a gradual four-week drift using the latest routine", () => {
    expect(analyseSmartShiftPatterns([
      shift("2026-08-10", "08:00", "17:00"),
      shift("2026-08-17", "08:15", "17:15"),
      shift("2026-08-24", "08:30", "17:30"),
      shift("2026-08-31", "08:45", "17:45"),
    ], AS_OF)).toEqual([expect.objectContaining({
      usualStartMinutes: 8 * 60 + 25,
      usualEndOffsetMinutes: 17 * 60 + 25,
    })]);
  });

  it("becomes ready immediately when the fourth qualifying shift completes today", () => {
    const monday = new Date(2026, 8, 7, 18, 0);
    expect(analyseSmartShiftPatterns([
      shift("2026-08-17"), shift("2026-08-24"), shift("2026-08-31"), shift("2026-09-07"),
    ], monday)).toHaveLength(1);
  });

  it("pauses an old routine during an unresolved multi-week time change", () => {
    const oldRoutine = [
      shift("2026-07-13", "08:00", "17:00"), shift("2026-07-20", "08:00", "17:00"),
      shift("2026-07-27", "08:00", "17:00"), shift("2026-08-03", "08:00", "17:00"),
      shift("2026-08-10", "08:00", "17:00"), shift("2026-08-17", "08:00", "17:00"),
    ];
    const changing = [
      shift("2026-08-24", "10:00", "18:00"), shift("2026-08-31", "10:00", "18:00"),
    ];
    expect(analyseSmartShiftPatterns([...oldRoutine, ...changing], AS_OF)).toEqual([]);
  });

  it("retires an abandoned weekday and requires four shifts in a post-break era", () => {
    const oldRoutine = [
      shift("2026-05-04"), shift("2026-05-11"), shift("2026-05-18"), shift("2026-05-25"),
    ];
    const threeAfterBreak = [
      shift("2026-08-17", "10:00", "18:00"), shift("2026-08-24", "10:00", "18:00"),
      shift("2026-08-31", "10:00", "18:00"),
    ];
    expect(analyseSmartShiftPatterns([...oldRoutine, ...threeAfterBreak], AS_OF)).toEqual([]);
    expect(analyseSmartShiftPatterns([
      ...oldRoutine,
      shift("2026-08-10", "10:00", "18:00"),
      ...threeAfterBreak,
    ], AS_OF)).toEqual([expect.objectContaining({ usualStartMinutes: 600, usualEndOffsetMinutes: 1080 })]);
  });

  it("retires a formerly weekly routine after two missed occurrences", () => {
    expect(analyseSmartShiftPatterns([
      shift("2026-07-20"), shift("2026-07-27"), shift("2026-08-03"), shift("2026-08-10"),
    ], AS_OF)).toEqual([]);
  });

  it("learns multiple newly added weekdays while retiring an old roster day", () => {
    const oldFridays = [
      shift("2026-05-01"), shift("2026-05-08"), shift("2026-05-15"), shift("2026-05-22"),
    ];
    const newMondays = [
      shift("2026-08-10", "09:00", "17:00"), shift("2026-08-17", "09:00", "17:00"),
      shift("2026-08-24", "09:00", "17:00"), shift("2026-08-31", "09:00", "17:00"),
    ];
    const newTuesdays = [
      shift("2026-08-11", "10:00", "18:00"), shift("2026-08-18", "10:00", "18:00"),
      shift("2026-08-25", "10:00", "18:00"), shift("2026-09-01", "10:00", "18:00"),
    ];
    expect(analyseSmartShiftPatterns([...oldFridays, ...newMondays, ...newTuesdays], AS_OF))
      .toEqual([
        expect.objectContaining({ weekdayName: "Monday", usualStartMinutes: 540 }),
        expect.objectContaining({ weekdayName: "Tuesday", usualStartMinutes: 600 }),
      ]);
  });

  it("reports existing-history progress before a routine is ready", () => {
    expect(getSmartShiftLearningProgress([
      shift("2026-08-17"), shift("2026-08-24"), shift("2026-08-31"),
    ], AS_OF)).toMatchObject({
      completedShiftCount: 3,
      bestWeekdayName: "Monday",
      bestWeekdayCount: 3,
    });
  });

  it("reports progress from the current roster era instead of counting retired history", () => {
    const retired = [
      shift("2026-05-04"), shift("2026-05-11"), shift("2026-05-18"), shift("2026-05-25"),
    ];
    expect(getSmartShiftLearningProgress(retired, AS_OF)).toMatchObject({
      completedShiftCount: 4,
      bestWeekdayName: null,
      bestWeekdayCount: 0,
    });
    expect(getSmartShiftLearningProgress([
      ...retired,
      shift("2026-08-24", "10:00", "18:00"),
      shift("2026-08-31", "10:00", "18:00"),
    ], AS_OF)).toMatchObject({
      bestWeekdayName: "Monday",
      bestWeekdayCount: 2,
    });
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

  it("removes today's sign-in alert, preserves next week and creates the sign-out alert", () => {
    const now = new Date(2026, 8, 7, 12, 0);
    const reminders = buildSmartReminderSchedule({
      accountId: "u1",
      firstName: "Ezaz",
      shifts: [shift("2026-09-07", "08:02", null, "open")],
      patterns: [mondayPattern],
      now,
    });
    expect(reminders).toHaveLength(2);
    expect(reminders[0]).toMatchObject({
      id: "signin-2026-09-14",
      kind: "signIn",
    });
    expect(reminders[1]).toEqual(expect.objectContaining({
      id: "signout-open",
      kind: "signOut",
      shiftId: "open",
      usualTimeLabel: "5:00 PM",
      body: "Hi Ezaz, your shift is still active, and you usually finish around 5:00 PM. Did you forget to sign out?",
    }));
    const fireAt = new Date(reminders[1].fireAtEpochMs);
    expect([fireAt.getHours(), fireAt.getMinutes()]).toEqual([17, 20]);
  });

  it("delivers a recently missed sign-in after one minute instead of losing it", () => {
    const reminders = buildSmartReminderSchedule({
      accountId: "u1",
      firstName: "Ezaz",
      shifts: [],
      patterns: [mondayPattern],
      now: new Date(2026, 8, 7, 9, 0),
    });
    expect(reminders[0].id).toBe("signin-2026-09-07");
    expect(reminders[0].fireAtEpochMs).toBe(new Date(2026, 8, 7, 9, 1).getTime());
  });

  it("does not create a stale alert more than four hours after the usual finish", () => {
    const reminders = buildSmartReminderSchedule({
      accountId: "u1",
      firstName: "Ezaz",
      shifts: [shift("2026-09-07", "08:00", null, "open")],
      patterns: [mondayPattern],
      now: new Date(2026, 8, 7, 23, 30),
    });
    expect(reminders.some((reminder) => reminder.kind === "signOut")).toBe(false);
    expect(reminders).toEqual([expect.objectContaining({ id: "signin-2026-09-14" })]);
  });

  it("does not apply the usual finish to a currently unusual start", () => {
    const reminders = buildSmartReminderSchedule({
      accountId: "u1",
      firstName: "Ezaz",
      shifts: [shift("2026-09-07", "14:00", null, "cover-shift")],
      patterns: [mondayPattern],
      now: new Date(2026, 8, 7, 15, 0),
    });
    expect(reminders.some((reminder) => reminder.kind === "signOut")).toBe(false);
    expect(reminders).toEqual([expect.objectContaining({ id: "signin-2026-09-14" })]);
  });
});
