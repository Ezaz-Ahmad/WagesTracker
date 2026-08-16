// The shared contract's default (web) behavior, and the configure/get
// plumbing every native adapter swap relies on — same shape as
// biometricAuth.test.ts's coverage of its own web default + configure.
import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingEndShift,
  clearShiftNotification,
  configureShiftNotifications,
  getPendingEndShift,
  postShiftStartedNotification,
  type ShiftNotificationAdapter,
} from "../shiftNotifications";

// configureShiftNotifications has module-level state with no reset export
// (same as configureBiometricAuth's `activeAdapter`) — restore the default
// web adapter after any test that swaps it in, so test order can't leak
// between files.
afterEach(() => {
  configureShiftNotifications({
    postShiftStarted: async () => {},
    clearShiftNotification: async () => {},
    getPendingEndShift: async () => null,
    clearPendingEndShift: async () => {},
  });
});

describe("web (default) shift-notification adapter", () => {
  it("postShiftStartedNotification() is a no-op that never throws", async () => {
    await expect(
      postShiftStartedNotification({
        shiftId: "s1",
        apiBaseUrl: "https://example.com",
        token: "t",
        startedAtLabel: "Started at 8:45 AM",
      }),
    ).resolves.toBeUndefined();
  });

  it("clearShiftNotification() is a no-op that never throws", async () => {
    await expect(clearShiftNotification()).resolves.toBeUndefined();
  });

  it("getPendingEndShift() always reports nothing pending", async () => {
    await expect(getPendingEndShift()).resolves.toBeNull();
  });

  it("clearPendingEndShift() is a no-op that never throws", async () => {
    await expect(clearPendingEndShift()).resolves.toBeUndefined();
  });
});

describe("configureShiftNotifications", () => {
  it("swaps the active adapter for every subsequent call", async () => {
    const posted: unknown[] = [];
    const fake: ShiftNotificationAdapter = {
      postShiftStarted: async (info) => {
        posted.push(info);
      },
      clearShiftNotification: async () => {},
      getPendingEndShift: async () => ({ shiftId: "s1", signOut: "17:00:00" }),
      clearPendingEndShift: async () => {},
    };
    configureShiftNotifications(fake);

    await postShiftStartedNotification({
      shiftId: "s1",
      apiBaseUrl: "https://example.com",
      token: "t",
      startedAtLabel: "Started at 8:45 AM",
    });
    expect(posted).toEqual([
      { shiftId: "s1", apiBaseUrl: "https://example.com", token: "t", startedAtLabel: "Started at 8:45 AM" },
    ]);

    await expect(getPendingEndShift()).resolves.toEqual({ shiftId: "s1", signOut: "17:00:00" });
  });
});
