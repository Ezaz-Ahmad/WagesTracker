import { afterEach, describe, expect, it, vi } from "vitest";
import {
  configureActiveShiftActivity,
  endActiveShiftActivity,
  isActiveShiftActivityConfigured,
  resetActiveShiftActivityForTests,
  retryPendingActiveShiftClockOut,
  startOrUpdateActiveShiftActivity,
} from "../activeShiftActivity";

afterEach(resetActiveShiftActivityForTests);

describe("active-shift activity platform contract", () => {
  it("is an inert, explicitly unavailable web default", async () => {
    expect(isActiveShiftActivityConfigured()).toBe(false);
    await expect(startOrUpdateActiveShiftActivity({
      shiftId: "s1",
      apiBaseUrl: "",
      clockOutToken: "",
      startedAtEpochMs: 0,
      location: "",
    })).resolves.toMatchObject({ status: "unavailable" });
    await expect(endActiveShiftActivity()).resolves.toBeUndefined();
  });

  it("delegates to the configured native adapter", async () => {
    const startOrUpdate = vi.fn().mockResolvedValue({ status: "active", pendingClockOut: false, completionNotifications: "denied" });
    const end = vi.fn().mockResolvedValue(undefined);
    const retryPendingClockOut = vi.fn().mockResolvedValue({ queued: true });
    configureActiveShiftActivity({
      startOrUpdate,
      end,
      retryPendingClockOut,
      subscribeEnded: async () => () => {},
    });
    expect(isActiveShiftActivityConfigured()).toBe(true);
    await endActiveShiftActivity({ shiftId: "s1", finalDurationSeconds: 60 });
    await expect(retryPendingActiveShiftClockOut()).resolves.toEqual({ queued: true });
    expect(end).toHaveBeenCalledWith({ shiftId: "s1", finalDurationSeconds: 60 });
  });
});
