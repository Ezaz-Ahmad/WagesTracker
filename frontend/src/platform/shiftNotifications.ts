/**
 * Shared, platform-neutral contract for the "shift in progress" local
 * notification — mirrors `biometricAuth.ts`'s shape exactly (a web no-op
 * default, a native iOS implementation swapped in at startup, see
 * `nativeShiftNotifications.ts`), so a future Android adapter can implement
 * this interface without any change to `useTodayShift`/AppContext.
 *
 * iOS has no concept of a truly undismissable notification — that is an
 * Android-only, foreground-service idea. This notification sits in the
 * notification center for as long as a shift is open, surviving
 * backgrounding/locking/closing the app, until the user swipes it away or
 * the shift actually ends (in-app, or via the notification's own "Sign
 * out" action) — but the user can always swipe it away manually, and doing
 * so does not itself end the shift.
 */

/** Everything the native side needs to both show the notification and,
 * later, finish the shift entirely on its own if "Sign out" is tapped
 * while the app process isn't running — see the Swift plugin for why this
 * can't simply run through the JS bridge in that case. */
export interface ShiftNotificationStartInfo {
  shiftId: string;
  /** Base API origin, e.g. `https://wage-tracker-api.onrender.com` — no
   * trailing slash, no `/api` suffix (the native side appends that itself,
   * matching `lib/api.ts`'s own convention). */
  apiBaseUrl: string;
  /** The current session's bearer token, copied at the moment the shift
   * starts — same trust boundary as the token this app already stores
   * behind biometrics (see `nativeBiometricAuth.ts`), not a new one. */
  token: string;
  /** Human-readable "Started at 8:45 AM" style label for the notification
   * body, formatted client-side so the native layer doesn't need its own
   * locale-formatting logic. */
  startedAtLabel: string;
}

/** A "Sign out" tap that happened while the app couldn't complete the
 * network call itself (no connectivity, or the OS reclaimed the background
 * execution window before the request finished) — recorded natively so the
 * app can finish the job through its own, already-tested API client the
 * next time it's opened, rather than losing the request. */
export interface PendingEndShift {
  shiftId: string;
  /** Wall-clock `HH:MM:SS` captured at the moment "Sign out" was tapped —
   * not re-derived later, so the recorded end time reflects when the user
   * actually asked to sign out, not whenever reconciliation happens to run. */
  signOut: string;
}

/** Outcome of a `postShiftStarted` attempt — never a thrown error (see that
 * method's own doc), since a caller like `useTodayShift.start()` must never
 * have a notification failure block or unwind a shift that already started
 * successfully. `ok: false` carries a human-readable reason so a caller that
 * *does* want to tell the user something couldn't be shown still can,
 * without needing to catch anything. */
export type ShiftNotificationResult = { ok: true } | { ok: false; error: string };

export interface ShiftNotificationAdapter {
  /** Posts (or replaces) the persistent notification. Never throws —
   * notification permission being denied, or any other platform failure,
   * must never block a shift from starting — but the returned result still
   * reports whether it actually worked, so a failure isn't entirely silent
   * to the person relying on it (see `useTodayShift.start()`). */
  postShiftStarted(info: ShiftNotificationStartInfo): Promise<ShiftNotificationResult>;
  /** Removes the notification and any native-held credential for it.
   * Called whenever the shift ends through the app itself — the
   * notification's own job is already done at that point. Safe to call
   * even when nothing is currently posted. */
  clearShiftNotification(): Promise<void>;
  /** Non-blocking check for a "Sign out" tap the native layer couldn't
   * finish on its own — see `PendingEndShift`. Polled once per app launch. */
  getPendingEndShift(): Promise<PendingEndShift | null>;
  /** Clears the pending record after the app has taken over finishing (or
   * confirming) the sign-out itself. */
  clearPendingEndShift(): Promise<void>;
}

class WebShiftNotificationAdapter implements ShiftNotificationAdapter {
  async postShiftStarted(): Promise<ShiftNotificationResult> {
    return { ok: true };
  }
  async clearShiftNotification(): Promise<void> {}
  async getPendingEndShift(): Promise<PendingEndShift | null> {
    return null;
  }
  async clearPendingEndShift(): Promise<void> {}
}

let activeAdapter: ShiftNotificationAdapter | undefined;

function adapter(): ShiftNotificationAdapter {
  activeAdapter ??= new WebShiftNotificationAdapter();
  return activeAdapter;
}

/** Native startup (see main.tsx) swaps this for `NativeShiftNotificationAdapter`
 * on an iOS build, mirroring `configureBiometricAuth`. */
export function configureShiftNotifications(next: ShiftNotificationAdapter): void {
  activeAdapter = next;
}

export function postShiftStartedNotification(info: ShiftNotificationStartInfo): Promise<ShiftNotificationResult> {
  return adapter().postShiftStarted(info);
}

export function clearShiftNotification(): Promise<void> {
  return adapter().clearShiftNotification();
}

export function getPendingEndShift(): Promise<PendingEndShift | null> {
  return adapter().getPendingEndShift();
}

export function clearPendingEndShift(): Promise<void> {
  return adapter().clearPendingEndShift();
}

const SHIFT_NOTIFICATION_ENABLED_KEY = "wageTracker.shiftNotificationEnabled";

/**
 * Whether the shift-in-progress notification should be posted at all — a
 * device-local preference (like Remember Me's remembered-email in
 * `lib/api.ts`, never synced to the backend, since it's purely about what
 * this one device's notification center shows) that the Settings toggle in
 * `ShiftNotificationSettings.tsx` controls and `useTodayShift`'s `start()`
 * checks before ever calling `postShiftStartedNotification`.
 *
 * Defaults to **on** — absence of the key (every existing install, and any
 * fresh one) reads as enabled, so shipping this toggle doesn't silently turn
 * a notification off that people were already relying on; only an explicit
 * "off" write changes the default. Irrelevant on web/PWA, where
 * `WebShiftNotificationAdapter` already no-ops every call regardless — the
 * Settings control itself only renders on native, same as
 * `BiometricLoginSettings`.
 */
export function isShiftNotificationEnabled(): boolean {
  return localStorage.getItem(SHIFT_NOTIFICATION_ENABLED_KEY) !== "off";
}

export function setShiftNotificationEnabled(enabled: boolean): void {
  if (enabled) {
    // Removing the key (rather than writing "on") keeps "no key" and
    // "explicitly turned on" indistinguishable, which is exactly the point —
    // there's nothing meaningful to tell them apart on, only "off" is ever a
    // real deviation from the default worth persisting.
    localStorage.removeItem(SHIFT_NOTIFICATION_ENABLED_KEY);
  } else {
    localStorage.setItem(SHIFT_NOTIFICATION_ENABLED_KEY, "off");
  }
}
