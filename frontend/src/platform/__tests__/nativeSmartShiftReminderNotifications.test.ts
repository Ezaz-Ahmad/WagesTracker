import { describe, expect, it, vi } from "vitest";
import {
  NativeSmartShiftReminderNotificationAdapter,
  type SmartShiftReminderPluginPort,
} from "../nativeSmartShiftReminderNotifications";

function plugin(overrides: Partial<SmartShiftReminderPluginPort> = {}): SmartShiftReminderPluginPort {
  return {
    smartReminderAuthorizationStatus: vi.fn().mockResolvedValue({ authorization: "authorized" }),
    requestSmartReminderAuthorization: vi.fn().mockResolvedValue({ authorization: "authorized" }),
    scheduleSmartReminders: vi.fn().mockResolvedValue({ authorization: "authorized", scheduledCount: 1 }),
    cancelSmartReminders: vi.fn().mockResolvedValue(undefined),
    consumePendingSmartReminderAction: vi.fn().mockResolvedValue({}),
    addListener: vi.fn().mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) }),
    ...overrides,
  };
}

describe("NativeSmartShiftReminderNotificationAdapter", () => {
  it("serializes the bounded schedule for the app-local Swift bridge", async () => {
    const port = plugin();
    const adapter = new NativeSmartShiftReminderNotificationAdapter(port);
    const options = {
      accountId: "u1",
      timeZone: "Australia/Sydney",
      reminders: [{
        id: "signin-2026-09-07",
        kind: "signIn" as const,
        fireAtEpochMs: 1_788_736_800_000,
        title: "Shift check-in",
        body: "Hi Ezaz, did you forget to sign in?",
        weekdayName: "Monday",
        usualTimeLabel: "8:00 AM",
      }],
    };
    await expect(adapter.schedule(options)).resolves.toEqual({ authorization: "authorized", scheduledCount: 1 });
    expect(port.scheduleSmartReminders).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(port.scheduleSmartReminders).mock.calls[0][0].payload;
    expect(JSON.parse(payload)).toEqual(options);
  });

  it("contains native failures so reminders can never break shift tracking", async () => {
    const adapter = new NativeSmartShiftReminderNotificationAdapter(plugin({
      scheduleSmartReminders: vi.fn().mockRejectedValue(new Error("notifications unavailable")),
    }));
    await expect(adapter.schedule({ accountId: "u1", timeZone: "UTC", reminders: [] }))
      .resolves.toEqual({ authorization: "unavailable", scheduledCount: 0 });
  });

  it("forwards an action once and clears its cold-launch fallback", async () => {
    let nativeListener: ((action: { accountId: string; kind: "signIn"; reminderId: string }) => void) | undefined;
    const consume = vi.fn().mockResolvedValue({});
    const remove = vi.fn().mockResolvedValue(undefined);
    const port = plugin({
      consumePendingSmartReminderAction: consume,
      addListener: vi.fn().mockImplementation(async (_name, listener) => {
        nativeListener = listener;
        return { remove };
      }),
    });
    const listener = vi.fn();
    const unsubscribe = await new NativeSmartShiftReminderNotificationAdapter(port).subscribeAction(listener);
    nativeListener?.({ accountId: "u1", kind: "signIn", reminderId: "signin-2026-09-07" });
    expect(listener).toHaveBeenCalledWith({ accountId: "u1", kind: "signIn", reminderId: "signin-2026-09-07" });
    expect(consume).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
