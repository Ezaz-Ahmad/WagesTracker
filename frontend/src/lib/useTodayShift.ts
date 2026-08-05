import { useApp } from "../context/AppContext";
import { isoDate, nowHHMMSS } from "./date";

export function useTodayShift() {
  const { today, shifts, user, createShift, updateShift } = useApp();
  const todayISO = isoDate(today);
  const todaysShifts = shifts.filter((s) => s.date === todayISO);
  const last = todaysShifts.length ? todaysShifts[todaysShifts.length - 1] : null;
  const active = !!(last && last.signIn && !last.signOut);

  const start = async () => {
    await createShift({ date: todayISO, location: user?.workLocationName || "", signIn: nowHHMMSS(), signOut: null });
  };

  const end = async () => {
    if (last && !last.signOut) {
      await updateShift(last.id, { signOut: nowHHMMSS() });
    }
  };

  return { active, last, start, end, todayISO };
}
