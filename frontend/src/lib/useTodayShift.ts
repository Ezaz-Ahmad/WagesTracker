import { useCallback, useState } from "react";
import { useApp } from "../context/AppContext";
import { findOpenShift } from "./aggregate";
import { formatTime12, isoDate, nowHHMMSS } from "./date";
import { useConfirm } from "../components/ConfirmProvider";
import { isUnusuallyLongShift, LONG_SHIFT_WARNING } from "./shiftRules";
import { getApiOrigin, getToken } from "./api";
import {
  clearShiftNotification,
  isShiftNotificationEnabled,
  postShiftStartedNotification,
  setShiftNotificationEnabled,
} from "../platform/shiftNotifications";

/**
 * Tracks the shift the Sign in/Sign out button (and the elapsed-time
 * displays on Home/Entry) should actually act on: the most recent *open*
 * shift across every loaded shift, not just one dated today. See
 * `findOpenShift` for why "today only" was wrong — a shift signed in before
 * midnight is still the same open shift after it, right up until it's
 * signed out.
 */
export function useTodayShift() {
  const confirm = useConfirm();
  const { today, shifts, user, createShift, updateShift, reportShiftNotificationIssue } = useApp();
  const todayISO = isoDate(today);
  const last = findOpenShift(shifts);
  const active = !!last;

  const start = async () => {
    // Belt-and-suspenders: the button itself only ever calls `start` when
    // `active` is already false (see ShiftButton's onClick), so this
    // shouldn't normally be reachable while a shift is open — but guarding
    // here too means any other future caller can't accidentally create a
    // second open shift client-side. A genuine race (another tab/device)
    // is still possible despite this; the backend is the real guard for
    // that (see routes/shifts.ts) and surfaces a clear "already open"
    // error instead of silently allowing a second one.
    if (active) return;
    const signIn = nowHHMMSS();
    const shift = await createShift({ date: todayISO, location: user?.workLocationName || "", signIn, signOut: null });
    if (!shift) return; // createShift already surfaced the error — nothing to notify about.
    const token = getToken();
    // Settings → Security → Shift notification lets this be turned off
    // per device (see isShiftNotificationEnabled) — checked here, not inside
    // the adapter, so a disabled preference means no notification call is
    // even attempted, not one that's silently swallowed downstream.
    if (token && isShiftNotificationEnabled()) {
      // Fire-and-forget: postShiftStartedNotification never throws (see
      // NativeShiftNotificationAdapter) — a notification permission
      // problem or any other platform failure must never make it look like
      // starting the shift itself failed. Its result is still inspected
      // once it settles, purely to surface a failure that would otherwise
      // be completely invisible (see shiftNotificationNotice on AppContext)
      // — this never delays or blocks the shift start above.
      void postShiftStartedNotification({
        shiftId: shift.id,
        apiBaseUrl: getApiOrigin(),
        token,
        startedAtLabel: `Started at ${formatTime12(signIn)}`,
      })
        .then((result) => {
          if (!result.ok) {
            reportShiftNotificationIssue(`Shift started, but the reminder notification couldn't be shown: ${result.error}`);
          }
        })
        .catch(() => {
          // postShiftStartedNotification's own contract is "never throws"
          // (see NativeShiftNotificationAdapter) — this only guards against a
          // pathological/misbehaving adapter implementation turning into an
          // unhandled promise rejection; there is nothing more specific to
          // report than the ok:false path above already covers.
        });
    }
  };

  const end = async () => {
    // PATCHes the original shift by id — never creates a new one, and never
    // touches its `date`, so an overnight shift stays filed under the day
    // it started regardless of what today's date is by the time this runs.
    if (last && !last.signOut) {
      const signOut = nowHHMMSS();
      if (isUnusuallyLongShift(last.signIn, signOut) && !(await confirm(LONG_SHIFT_WARNING))) return;
      const updated = await updateShift(last.id, { signOut });
      if (updated) {
        // The notification (and any native-held credential behind it) has
        // done its job — the shift ended through the app itself, so there
        // is nothing left for a background "Sign out" tap to finish later.
        void clearShiftNotification();
      }
    }
  };

  return { active, last, start, end, todayISO };
}

/**
 * Backs the "Shift notification" toggle in Settings → Security
 * (`ShiftNotificationSettings.tsx`). Deliberately just a persisted
 * preference — it does not reach into `shifts`/app state to react to a
 * shift that's already open. Two reasons: turning this off is not a safety
 * measure (the notification's "Sign out" action isn't a new trust boundary —
 * see `shiftNotifications.ts`'s own comment on that), so there is no
 * correctness reason to force it away immediately rather than letting it
 * naturally clear itself when that shift ends; and a Settings toggle
 * pulling in full shift/app state to reach across screens is a needless
 * coupling for a component that renders unconditionally alongside the rest
 * of the Security page (a Settings test harness has no reason to expect a
 * shift-notification toggle to need `shifts` in its fixture at all). The
 * preference takes effect starting with the *next* shift — see `start()`
 * above, the only other place it's read.
 */
export function useShiftNotificationSetting() {
  const [enabled, setEnabledState] = useState(isShiftNotificationEnabled);

  const setEnabled = useCallback((next: boolean) => {
    setShiftNotificationEnabled(next);
    setEnabledState(next);
  }, []);

  return { enabled, setEnabled };
}
