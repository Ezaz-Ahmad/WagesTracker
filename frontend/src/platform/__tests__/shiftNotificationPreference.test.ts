// @vitest-environment jsdom
//
// isShiftNotificationEnabled/setShiftNotificationEnabled: the device-local
// preference backing the "Shift notification" toggle in Settings → Security
// (see ShiftNotificationSettings.tsx). Real localStorage, not a mock — this
// is the one place that contract is actually exercised end to end.
import { afterEach, describe, expect, it } from "vitest";
import { isShiftNotificationEnabled, setShiftNotificationEnabled } from "../shiftNotifications";

afterEach(() => {
  localStorage.clear();
});

describe("shift-notification enabled preference", () => {
  it("defaults to enabled with nothing stored yet", () => {
    expect(isShiftNotificationEnabled()).toBe(true);
  });

  it("stays enabled after being explicitly turned on", () => {
    setShiftNotificationEnabled(true);
    expect(isShiftNotificationEnabled()).toBe(true);
  });

  it("reports disabled once explicitly turned off, and persists that across reads", () => {
    setShiftNotificationEnabled(false);
    expect(isShiftNotificationEnabled()).toBe(false);
    expect(isShiftNotificationEnabled()).toBe(false);
  });

  it("goes back to enabled once turned back on after being off", () => {
    setShiftNotificationEnabled(false);
    expect(isShiftNotificationEnabled()).toBe(false);
    setShiftNotificationEnabled(true);
    expect(isShiftNotificationEnabled()).toBe(true);
  });

  it("turning it on removes the stored key rather than writing an explicit value", () => {
    setShiftNotificationEnabled(false);
    setShiftNotificationEnabled(true);
    expect(localStorage.getItem("wageTracker.shiftNotificationEnabled")).toBeNull();
  });
});
