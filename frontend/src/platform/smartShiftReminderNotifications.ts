import type { SmartReminderScheduleItem } from "../lib/smartShiftReminders";

export type NotificationAuthorization = "authorized" | "denied" | "notDetermined" | "unavailable";

export interface SmartReminderAction {
  accountId: string;
  kind: "signIn" | "signOut";
  reminderId: string;
  shiftId?: string;
  weekdayName?: string;
  usualTimeLabel?: string;
}

export interface SmartReminderSyncResult {
  authorization: NotificationAuthorization;
  scheduledCount: number;
}

export interface SmartShiftReminderNotificationAdapter {
  authorizationStatus(): Promise<NotificationAuthorization>;
  requestAuthorization(): Promise<NotificationAuthorization>;
  schedule(options: {
    accountId: string;
    timeZone: string;
    reminders: SmartReminderScheduleItem[];
  }): Promise<SmartReminderSyncResult>;
  cancel(): Promise<void>;
  consumePendingAction(): Promise<SmartReminderAction | null>;
  subscribeAction(listener: (action: SmartReminderAction) => void): Promise<() => void>;
}

class WebSmartShiftReminderAdapter implements SmartShiftReminderNotificationAdapter {
  async authorizationStatus(): Promise<NotificationAuthorization> { return "unavailable"; }
  async requestAuthorization(): Promise<NotificationAuthorization> { return "unavailable"; }
  async schedule(): Promise<SmartReminderSyncResult> {
    return { authorization: "unavailable", scheduledCount: 0 };
  }
  async cancel(): Promise<void> {}
  async consumePendingAction(): Promise<SmartReminderAction | null> { return null; }
  async subscribeAction(): Promise<() => void> { return () => {}; }
}

let adapter: SmartShiftReminderNotificationAdapter = new WebSmartShiftReminderAdapter();
let configured = false;

export function configureSmartShiftReminderNotifications(next: SmartShiftReminderNotificationAdapter): void {
  adapter = next;
  configured = true;
}

export function isSmartShiftReminderNotificationsConfigured(): boolean {
  return configured;
}

export function getSmartReminderAuthorization(): Promise<NotificationAuthorization> {
  return adapter.authorizationStatus();
}

export function requestSmartReminderAuthorization(): Promise<NotificationAuthorization> {
  return adapter.requestAuthorization();
}

export function syncSmartShiftReminderNotifications(options: {
  accountId: string;
  timeZone: string;
  reminders: SmartReminderScheduleItem[];
}): Promise<SmartReminderSyncResult> {
  return adapter.schedule(options);
}

export function cancelSmartShiftReminderNotifications(): Promise<void> {
  return adapter.cancel();
}

export function consumePendingSmartReminderAction(): Promise<SmartReminderAction | null> {
  return adapter.consumePendingAction();
}

export function subscribeSmartReminderAction(
  listener: (action: SmartReminderAction) => void
): Promise<() => void> {
  return adapter.subscribeAction(listener);
}

export function resetSmartShiftReminderNotificationsForTests(): void {
  adapter = new WebSmartShiftReminderAdapter();
  configured = false;
}
