import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { addDays, isoDate, startOfWeek } from "../lib/date";
import type { DayExpense, Shift, User, WeekExtra } from "../lib/types";

export const RETENTION_YEARS = 5;
export const CURRENCY = "$";

// After this long with no mouse/keyboard/touch activity, the session is
// cleared automatically — a security measure, independent of "remember me"
// (which controls whether a session survives a browser restart, not how long
// an unattended one stays open). This only clears the local session: an
// open shift keeps accruing time from its stored sign-in timestamp on the
// server regardless of whether the app is logged in, so nothing is lost —
// signing back in picks the running total back up exactly where it left off.
const IDLE_LOGOUT_MS = 10 * 60 * 1000;

// On mobile, submitting the login/signup form happens while the on-screen
// keyboard is still open. If we flip straight to the authed shell at that
// instant, iOS Safari paints the `100dvh` app shell against the viewport as
// it looks *with the keyboard still closing* — leaving a gap under the
// bottom nav until the next real scroll nudges Safari into recomputing it.
// Blurring the field and waiting one real keyboard-close cycle (via
// `visualViewport`'s resize event, since that's what actually fires when
// the keyboard animates away) means the shell only ever mounts against the
// settled viewport. Skipped entirely when no keyboard is open (desktop, or
// a fast auto-login) so it never adds latency where there's nothing to wait
// for.
async function settleKeyboardBeforeAuth(): Promise<void> {
  const active = document.activeElement as HTMLElement | null;
  active?.blur();
  const vv = window.visualViewport;
  if (!vv) return;
  const keyboardLikelyOpen = window.innerHeight - vv.height > 80;
  if (!keyboardLikelyOpen) return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      vv.removeEventListener("resize", finish);
      clearTimeout(timer);
      resolve();
    };
    vv.addEventListener("resize", finish);
    const timer = setTimeout(finish, 400);
  });
}

type Status = "loading" | "loggedOut" | "loggedIn";

interface AppContextValue {
  status: Status;
  user: User | null;
  authError: string | null;
  authBusy: boolean;
  actionError: string | null;
  clearActionError: () => void;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  signup: (input: api.SignupInput) => Promise<void>;
  logout: () => void;
  clearAuthError: () => void;
  updateSettings: (patch: api.MePatch) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;

  today: Date;
  shifts: Shift[];
  shiftsLoading: boolean;
  shiftsLoaded: boolean;
  createShift: (input: api.ShiftInput) => Promise<Shift | undefined>;
  updateShift: (id: string, patch: Partial<api.ShiftInput>) => Promise<Shift | undefined>;
  removeShift: (id: string) => Promise<void>;

  dayExpenses: DayExpense[];
  setFuelCost: (date: string, fuelCost: number | null) => Promise<void>;

  weekExtras: WeekExtra[];
  setWeekExtra: (weekStart: string, amount: number | null, reason: string) => Promise<boolean>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [dayExpenses, setDayExpenses] = useState<DayExpense[]>([]);
  const [weekExtras, setWeekExtras] = useState<WeekExtra[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  // Sticky — true after the first successful/attempted load and never reset, so
  // screens can show a one-time loading state instead of flashing $0 totals
  // before the real numbers arrive, without re-showing it on background refetches.
  const [shiftsLoaded, setShiftsLoaded] = useState(false);
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const token = api.getToken();
    if (!token) {
      setStatus("loggedOut");
      return;
    }
    api
      .fetchMe()
      .then(({ user }) => {
        setUser(user);
        setStatus("loggedIn");
      })
      .catch((e) => {
        // Only drop the session on an actual auth failure. A network blip or a
        // momentarily-unreachable backend shouldn't force the user to log back in.
        if (e instanceof ApiError && e.status === 401) {
          api.clearToken();
        }
        setStatus("loggedOut");
      });
  }, []);

  const reloadShifts = useCallback(async (u: User, anchor: Date) => {
    setShiftsLoading(true);
    try {
      const cutoff = new Date(anchor.getFullYear() - RETENTION_YEARS, anchor.getMonth(), anchor.getDate());
      const weekEnd = addDays(startOfWeek(anchor, u.weekStartsOn), 6);
      const [{ shifts }, { expenses }, { extras }] = await Promise.all([
        api.listShifts(isoDate(cutoff), isoDate(weekEnd)),
        api.listDayExpenses(isoDate(cutoff), isoDate(weekEnd)),
        api.listWeekExtras(isoDate(cutoff), isoDate(weekEnd)),
      ]);
      setShifts(shifts);
      setDayExpenses(expenses);
      setWeekExtras(extras);
    } finally {
      setShiftsLoading(false);
      setShiftsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (status === "loggedIn" && user) {
      void reloadShifts(user, today);
    }
    // Re-fetch when the week-start setting changes the window we need, or the day rolls over.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, user?.id, user?.weekStartsOn, reloadShifts]);

  const login = useCallback(async (email: string, password: string, remember: boolean = true) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const { token, user } = await api.login(email, password);
      api.setToken(token, remember);
      if (remember) api.setRememberedEmail(email);
      else api.clearRememberedEmail();
      setUser(user);
      await settleKeyboardBeforeAuth();
      setStatus("loggedIn");
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Could not log in");
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const signup = useCallback(async (input: api.SignupInput) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const { token, user } = await api.signup(input);
      api.setToken(token, true);
      setUser(user);
      await settleKeyboardBeforeAuth();
      setStatus("loggedIn");
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Could not create account");
    } finally {
      setAuthBusy(false);
    }
  }, []);

  const logout = useCallback(() => {
    api.clearToken();
    setUser(null);
    setShifts([]);
    setDayExpenses([]);
    setWeekExtras([]);
    setShiftsLoaded(false);
    setStatus("loggedOut");
  }, []);

  // Idle auto-logout: resets on any real interaction while logged in, and
  // signs out (with an explanatory message on the login screen) if none
  // arrives within IDLE_LOGOUT_MS. A closed tab/browser has the same effect
  // for non-"remember me" sessions already, since those live in
  // sessionStorage and are gone the moment the tab closes.
  useEffect(() => {
    if (status !== "loggedIn") return;

    let timer: ReturnType<typeof setTimeout>;
    const handleIdle = () => {
      logout();
      setAuthError("You were logged out after 10 minutes of inactivity. Any shift in progress kept counting — log back in to see it.");
    };
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(handleIdle, IDLE_LOGOUT_MS);
    };

    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;
    activityEvents.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      clearTimeout(timer);
      activityEvents.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [status, logout]);

  // Left to throw on failure (e.g. wrong password) so the confirmation dialog can show the
  // error inline instead of routing it through the top-level action-error banner.
  const deleteAccount = useCallback(async (password: string) => {
    await api.deleteAccount(password);
    api.clearToken();
    api.clearRememberedEmail();
    setUser(null);
    setShifts([]);
    setDayExpenses([]);
    setWeekExtras([]);
    setShiftsLoaded(false);
    setStatus("loggedOut");
  }, []);

  // Shared handling for authenticated actions (settings/shifts): an expired or invalid
  // token logs the user out with a clear reason instead of failing silently; any other
  // failure (validation, network) surfaces as a dismissible message instead of an
  // unhandled promise rejection.
  const handleActionError = useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof ApiError && e.status === 401) {
        logout();
        setActionError("Your session expired. Please log in again.");
        return;
      }
      setActionError(e instanceof Error ? e.message : fallback);
    },
    [logout]
  );

  const updateSettings = useCallback(
    async (patch: api.MePatch) => {
      try {
        const { user } = await api.patchMe(patch);
        setUser(user);
      } catch (e) {
        handleActionError(e, "Couldn't save settings");
      }
    },
    [handleActionError]
  );

  const createShift = useCallback(
    async (input: api.ShiftInput) => {
      try {
        const { shift } = await api.createShift(input);
        setShifts((prev) => [...prev, shift]);
        return shift;
      } catch (e) {
        handleActionError(e, "Couldn't save shift");
        return undefined;
      }
    },
    [handleActionError]
  );

  const updateShift = useCallback(
    async (id: string, patch: Partial<api.ShiftInput>) => {
      try {
        const { shift } = await api.patchShift(id, patch);
        setShifts((prev) => prev.map((s) => (s.id === id ? shift : s)));
        return shift;
      } catch (e) {
        handleActionError(e, "Couldn't update shift");
        return undefined;
      }
    },
    [handleActionError]
  );

  const removeShift = useCallback(
    async (id: string) => {
      try {
        await api.deleteShift(id);
        setShifts((prev) => prev.filter((s) => s.id !== id));
      } catch (e) {
        handleActionError(e, "Couldn't remove shift");
      }
    },
    [handleActionError]
  );

  // Optimistic — the amount box is meant to feel instant like everything else on
  // this screen. Rolls back to the previous value if the request fails.
  const setFuelCost = useCallback(
    async (date: string, fuelCost: number | null) => {
      const prev = dayExpenses;
      setDayExpenses((cur) => {
        const rest = cur.filter((e) => e.date !== date);
        return fuelCost && fuelCost > 0 ? [...rest, { date, fuelCost }] : rest;
      });
      try {
        await api.setDayExpense(date, fuelCost);
      } catch (e) {
        setDayExpenses(prev);
        handleActionError(e, "Couldn't save fuel cost");
      }
    },
    [dayExpenses, handleActionError]
  );

  // Same optimistic pattern as fuel cost, but keyed by week start rather than
  // day, and it can fail validation (missing reason) — returns whether the
  // save actually went through so the form can surface that inline instead of
  // just going through the generic action-error banner.
  const setWeekExtra = useCallback(
    async (weekStart: string, amount: number | null, reason: string): Promise<boolean> => {
      const prev = weekExtras;
      setWeekExtras((cur) => {
        const rest = cur.filter((w) => w.weekStart !== weekStart);
        return amount && amount > 0 ? [...rest, { weekStart, amount, reason }] : rest;
      });
      try {
        await api.setWeekExtra(weekStart, { amount, reason });
        return true;
      } catch (e) {
        setWeekExtras(prev);
        if (e instanceof ApiError && e.status === 400) {
          setActionError(e.message);
        } else {
          handleActionError(e, "Couldn't save other earnings");
        }
        return false;
      }
    },
    [weekExtras, handleActionError]
  );

  const value = useMemo<AppContextValue>(
    () => ({
      status,
      user,
      authError,
      authBusy,
      actionError,
      clearActionError: () => setActionError(null),
      login,
      signup,
      logout,
      clearAuthError: () => setAuthError(null),
      updateSettings,
      deleteAccount,
      today,
      shifts,
      shiftsLoading,
      shiftsLoaded,
      createShift,
      updateShift,
      removeShift,
      dayExpenses,
      setFuelCost,
      weekExtras,
      setWeekExtra,
    }),
    [
      status,
      user,
      authError,
      authBusy,
      actionError,
      login,
      signup,
      logout,
      updateSettings,
      deleteAccount,
      today,
      shifts,
      shiftsLoading,
      shiftsLoaded,
      createShift,
      updateShift,
      removeShift,
      dayExpenses,
      setFuelCost,
      weekExtras,
      setWeekExtra,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
