import { describe, expect, it } from "vitest";
import { feedbackForApiError } from "../apiErrorFeedback";
import { conflictSchedule, parseShiftConflict } from "../shiftConflict";

const shift = { jobName: "City Retail", location: "Newcastle", date: "2026-11-22", signIn: "22:00:30", signOut: "06:00" };
describe("clear error guidance", () => {
  it("shows exact overnight dates, AM/PM and non-zero seconds", () => {
    expect(conflictSchedule(shift)).toEqual({ date: "Sun, 22 Nov 2026", start: "10:00:30 pm", end: "6:00 am", endDate: "Mon, 23 Nov 2026" });
  });
  it("rejects malformed details and strips unrelated properties", () => {
    const conflict = { kind: "overlap", attempted: shift, conflicts: [shift], totalConflicts: 1, internal: "unused" };
    expect(parseShiftConflict(conflict)).not.toHaveProperty("internal");
    for (const bad of [null, { ...conflict, kind: { toString: 5 } }, { ...conflict, conflicts: [] }, { ...conflict, attempted: { ...shift, date: "2026-02-30" } }, { ...conflict, attempted: { ...shift, signIn: "25:00" } }, { ...conflict, totalConflicts: 0 }]) expect(parseShiftConflict(bad)).toBeUndefined();
  });
  it.each([
    [{ status: 429, message: "Too many attempts." }, "Please wait a moment", "Got it"],
    [{ status: 401, message: "Incorrect current password" }, "Check your current password", "Review password"],
    [{ status: 401, message: "Your sign-in expired. Please log in again." }, "Sign in again", "Back to sign-in"],
    [{ status: 409, message: "This shift changed on another device. Refresh it before saving again." }, "This record has changed", "Got it"],
    [{ status: 0, code: "REQUEST_TIMEOUT", message: "We couldn't confirm the result in time. Refresh to check it before trying again." }, "Check whether it saved", "Got it"],
    [{ status: 503, message: "Temporarily unavailable" }, "Service temporarily unavailable", "Got it"],
  ] as const)("gives a relevant title and action for %j", (failure, title, action) => {
    const feedback = feedbackForApiError(failure);
    expect(feedback.title).toBe(title); expect(feedback.actionLabel).toBe(action);
    expect(feedback.hint).not.toMatch(/highlighted field|different value/);
  });
  it("uses a structured comparison for shift overlaps", () => {
    const conflict = parseShiftConflict({ kind: "overlap", attempted: shift, conflicts: [shift], totalConflicts: 1 })!;
    const feedback = feedbackForApiError({ status: 409, message: "Legacy fallback", code: "SHIFT_OVERLAP", conflict });
    expect(feedback.title).toBe("These shifts overlap");
    expect(feedback.conflict).toEqual(conflict);
    expect(feedback.actionLabel).toBe("Review times");
  });
});
