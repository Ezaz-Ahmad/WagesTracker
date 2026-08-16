import { useApp } from "../context/AppContext";
import { findOpenShift } from "./aggregate";
import { formatTime12, isoDate, nowHHMMSS } from "./date";
import { useConfirm } from "../components/ConfirmProvider";
import { isUnusuallyLongShift, LONG_SHIFT_WARNING } from "./shiftRules";
import { getApiOrigin, getToken } from "./api";
import { clearShiftNotification, postShiftStartedNotification } from "../platform/shiftNotifications";

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
  const { today, shifts, user, createShift, updateShift } = useApp();
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
    if (token) {
      // Fire-and-forget: postShiftStartedNotification never throws (see
      // NativeShiftNotificationAdapter) — a notification permission
      // problem or any other platform failure must never make it look like
      // starting the shift itself failed.
      void postShiftStartedNotification({
        shiftId: shift.id,
        apiBaseUrl: getApiOrigin(),
        token,
        startedAtLabel: `Started at ${formatTime12(signIn)}`,
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
