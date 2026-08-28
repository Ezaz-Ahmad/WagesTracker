import { useApp } from "../context/AppContext";
import { findOpenShift } from "./aggregate";
import { isoDate, nowHHMMSS } from "./date";
import { useConfirm } from "../components/ConfirmProvider";
import { isUnusuallyLongShift, LONG_SHIFT_WARNING } from "./shiftRules";

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
  const { today, shifts, workLocations, createShift, updateShift } = useApp();
  const todayISO = isoDate(today);
  const last = findOpenShift(shifts);
  const active = !!last;

  const startAtLocation = async (selectedWorkLocationId?: string | null) => {
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
    const activeLocations = (workLocations ?? []).filter((location) => !location.archived);
    const workLocationId = selectedWorkLocationId || (activeLocations.length === 1 ? activeLocations[0].id : null);
    if (!workLocationId) return;
    const selected = activeLocations.find((location) => location.id === workLocationId);
    if (!selected) return;
    await createShift({ date: todayISO, workLocationId, location: selected.name, signIn, signOut: null });
  };

  const start = async () => startAtLocation();

  const end = async () => {
    // PATCHes the original shift by id — never creates a new one, and never
    // touches its `date`, so an overnight shift stays filed under the day
    // it started regardless of what today's date is by the time this runs.
    if (last && !last.signOut) {
      const signOut = nowHHMMSS();
      if (isUnusuallyLongShift(last.signIn, signOut) && !(await confirm(LONG_SHIFT_WARNING))) return;
      await updateShift(last.id, { signOut });
    }
  };

  return { active, last, start, startAtLocation, end, todayISO };
}
