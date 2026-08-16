import { registerPlugin } from "@capacitor/core";
import type {
  PendingEndShift,
  ShiftNotificationAdapter,
  ShiftNotificationResult,
  ShiftNotificationStartInfo,
} from "./shiftNotifications";

/**
 * Raw shape of the native `ShiftNotificationPlugin.swift` bridge (see
 * `ios/App/App/ShiftNotificationPlugin.swift`) — app-local Swift compiled
 * directly into the App target, same mechanism as `BiometricAuthPlugin`
 * (see `nativeBiometricAuth.ts` for the identical `registerPlugin` pattern).
 */
export interface ShiftNotificationPluginPort {
  postShiftStarted(options: {
    shiftId: string;
    apiBaseUrl: string;
    token: string;
    startedAtLabel: string;
  }): Promise<void>;
  clearShiftNotification(): Promise<void>;
  /** `hasPending` is the explicit signal — a Capacitor plugin call can only
   * ever resolve to an object, never a bare `null`, so "nothing pending" is
   * `{ hasPending: false }` rather than an empty/absent result the caller
   * would have to infer meaning from. */
  getPendingEndShift(): Promise<{ hasPending: boolean; shiftId?: string; signOut?: string }>;
  clearPendingEndShift(): Promise<void>;
}

const ShiftNotificationPlugin = registerPlugin<ShiftNotificationPluginPort>("ShiftNotification");

/** Native implementation of the shared shift-notification contract. Every
 * method is deliberately forgiving of a plugin-side failure — posting a
 * notification (or failing to) must never be allowed to affect whether a
 * shift itself started/ended successfully, since that decision has already
 * been made by the time these are called (see `useTodayShift.ts`). */
export class NativeShiftNotificationAdapter implements ShiftNotificationAdapter {
  constructor(private readonly plugin: ShiftNotificationPluginPort = ShiftNotificationPlugin) {}

  async postShiftStarted(info: ShiftNotificationStartInfo): Promise<ShiftNotificationResult> {
    try {
      await this.plugin.postShiftStarted(info);
      return { ok: true };
    } catch (error) {
      // Notification permission denied, or any other platform failure — the
      // shift itself is already running; not being able to show a
      // notification about it is not a reason to interrupt the user. Still
      // reported back (not just logged) so a caller can tell the person
      // relying on this reminder that it didn't actually show up — see
      // `useTodayShift.start()`.
      console.error("Could not post the shift-in-progress notification", error);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async clearShiftNotification(): Promise<void> {
    try {
      await this.plugin.clearShiftNotification();
    } catch (error) {
      console.error("Could not clear the shift-in-progress notification", error);
    }
  }

  async getPendingEndShift(): Promise<PendingEndShift | null> {
    try {
      const result = await this.plugin.getPendingEndShift();
      if (!result.hasPending || !result.shiftId || !result.signOut) return null;
      return { shiftId: result.shiftId, signOut: result.signOut };
    } catch (error) {
      // Treated the same as "nothing pending" — a failed read here must
      // never block normal app startup, and there is nothing destructive
      // about silently missing one reconciliation opportunity (the
      // notification itself, if still posted, is still tappable).
      console.error("Could not read the pending end-shift record", error);
      return null;
    }
  }

  async clearPendingEndShift(): Promise<void> {
    try {
      await this.plugin.clearPendingEndShift();
    } catch (error) {
      console.error("Could not clear the pending end-shift record", error);
    }
  }
}
