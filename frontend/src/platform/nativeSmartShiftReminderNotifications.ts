import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { SmartReminderScheduleItem } from "../lib/smartShiftReminders";
import type {
  NotificationAuthorization,
  SmartReminderAction,
  SmartReminderSyncResult,
  SmartShiftReminderNotificationAdapter,
} from "./smartShiftReminderNotifications";

export interface SmartShiftReminderPluginPort {
  smartReminderAuthorizationStatus(): Promise<{ authorization: NotificationAuthorization }>;
  requestSmartReminderAuthorization(): Promise<{ authorization: NotificationAuthorization }>;
  scheduleSmartReminders(options: { payload: string }): Promise<SmartReminderSyncResult>;
  cancelSmartReminders(): Promise<void>;
  consumePendingSmartReminderAction(): Promise<{ action?: SmartReminderAction }>;
  addListener(
    eventName: "smartReminderAction",
    listener: (action: SmartReminderAction) => void
  ): Promise<PluginListenerHandle>;
}

const NativePlugin = registerPlugin<SmartShiftReminderPluginPort>("ActiveShiftActivity");

export class NativeSmartShiftReminderNotificationAdapter implements SmartShiftReminderNotificationAdapter {
  constructor(private readonly plugin: SmartShiftReminderPluginPort = NativePlugin) {}

  async authorizationStatus(): Promise<NotificationAuthorization> {
    try {
      return (await this.plugin.smartReminderAuthorizationStatus()).authorization;
    } catch {
      return "unavailable";
    }
  }

  async requestAuthorization(): Promise<NotificationAuthorization> {
    try {
      return (await this.plugin.requestSmartReminderAuthorization()).authorization;
    } catch (error) {
      console.error("Could not request smart-reminder notification permission", error);
      return "unavailable";
    }
  }

  async schedule(options: {
    accountId: string;
    timeZone: string;
    reminders: SmartReminderScheduleItem[];
  }): Promise<SmartReminderSyncResult> {
    try {
      return await this.plugin.scheduleSmartReminders({ payload: JSON.stringify(options) });
    } catch (error) {
      console.error("Could not schedule smart shift reminders", error);
      return { authorization: "unavailable", scheduledCount: 0 };
    }
  }

  async cancel(): Promise<void> {
    try {
      await this.plugin.cancelSmartReminders();
    } catch (error) {
      console.error("Could not cancel smart shift reminders", error);
    }
  }

  async consumePendingAction(): Promise<SmartReminderAction | null> {
    try {
      return (await this.plugin.consumePendingSmartReminderAction()).action ?? null;
    } catch {
      return null;
    }
  }

  async subscribeAction(listener: (action: SmartReminderAction) => void): Promise<() => void> {
    const handle = await this.plugin.addListener("smartReminderAction", (action) => {
      listener(action);
      // The delegate persists foreground actions before the WebView is ready.
      // Once a live listener has received one, clear that launch fallback so
      // it cannot be replayed on the next cold start.
      void this.plugin.consumePendingSmartReminderAction();
    });
    return () => { void handle.remove(); };
  }
}
