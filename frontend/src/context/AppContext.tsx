import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
//
// Enforced regardless of *how* the app was away — not just a live in-page
// timer counting up while the tab sits open. The elapsed time is measured
// against a timestamp in localStorage (see recordActivity/getLastActivity
// in lib/api.ts), which survives the app being minimized, backgrounded, or
// killed and relaunched. So: minimize the app for 20 minutes and reopen it,
// and it logs out and asks for credentials immediately — no silent
// auto-login, no waiting on the server — even though nothing was "counting"
// while it was closed.
const IDLE_LOGOUT_MS = 15 * 60 * 1000;
const IDLE_LOGOUT_MESSAGE =
  "You were logged out after 15 minutes of inactivity. Any shift in progress kept counting — log back in to see it.";

// How long a manual "reveal" of the earnings-privacy toggle lasts before it
// auto-hides again — a flat window from the moment of reveal, not an idle
// timer, so it hides itself right on schedule even while the app is in
// active use (see revealEarnings below).
const EARNINGS_REVEAL_MS = 20 * 60 * 1000;

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

  refresh: () => Promise<void>;

  earningsHidden: boolean;
  revealEarnings: () => void;
  hideEarningsNow: () => void;
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

  // Earnings-privacy toggle: dollar figures across the app render blurred
  // until explicitly revealed, and always start hidden again on a fresh
  // login — see the eye button in the top nav. Starting `true` by default
  // covers both a brand-new session *and* a token-based auto-login without
  // any extra logic; `logout`/`login`/`signup` reset it explicitly too, so
  // it's also correct if a logout happens without a full page reload.
  const [earningsHidden, setEarningsHidden] = useState(true);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRevealTimer = useCallback(() => {
    if (revealTimerRef.current) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }, []);

  const revealEarnings = useCallback(() => {
    setEarningsHidden(false);
    clearRevealTimer();
    revealTimerRef.current = setTimeout(() => {
      setEarningsHidden(true);
      revealTimerRef.current = null;
    }, EARNINGS_REVEAL_MS);
  }, [clearRevealTimer]);

  const hideEarningsNow = useCallback(() => {
    setEarningsHidden(true);
    clearRevealTimer();
  }, [clearRevealTimer]);

  useEffect(() => clearRevealTimer, [clearRevealTimer]);

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

    // The idle timeout applies even across a full close/relaunch: if more
    // time has passed since the last recorded activity than the timeout
    // allows, this is exactly an idle logout — clear the session and show
    // the login form immediately. No silent auto-login attempt, and
    // critically no wake-up-screen wait on a possibly-cold server for a
    // session we're about to throw away anyway.
    const lastActivity = api.getLastActivity();
    if (lastActivity !== null && Date.now() - lastActivity >= IDLE_LOGOUT_MS) {
      api.clearToken();
      api.clearLastActivity();
      setStatus("loggedOut");
      setAuthError(IDLE_LOGOUT_MESSAGE);
      return;
    }

    api
      .fetchMe()
      .then(({ user }) => {
        setUser(user);
        api.recordActivity();
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
      api.recordActivity();
      if (remember) api.setRememberedEmail(email);
      else api.clearRememberedEmail();
      setUser(user);
      hideEarningsNow();
      await settleKeyboardBeforeAuth();
      setStatus("loggedIn");
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Could not log in");
    } finally {
      setAuthBusy(false);
    }
  }, [hideEarningsNow]);

  const signup = useCallback(async (input: api.SignupInput) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const { token, user } = await api.signup(input);
      api.setToken(token, true);
      api.recordActivity();
      setUser(user);
      hideEarningsNow();
      await settleKeyboardBeforeAuth();
      setStatus("loggedIn");
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : "Could not create account");
    } finally {
      setAuthBusy(false);
    }
  }, [hideEarningsNow]);

  const logout = useCallback(() => {
    api.clearToken();
    api.clearLastActivity();
    setUser(null);
    setShifts([]);
    setDayExpenses([]);
    setWeekExtras([]);
    setShiftsLoaded(false);
    setStatus("loggedOut");
    hideEarningsNow();
  }, [hideEarningsNow]);

  // Pulled by the Home screen's pull-to-refresh gesture. Re-fetches both the
  // user profile (in case rate/goals changed from another device or the
  // admin panel) and shifts/expenses/extras — the same data an app reload
  // would fetch, without the jank of an actual page reload. Silent on
  // failure (a background refresh someone can just retry by pulling again)
  // except for an expired session, which needs the normal logout handling.
  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const { user: freshUser } = await api.fetchMe();
      setUser(freshUser);
      await reloadShifts(freshUser, today);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        logout();
        setActionError("Your session expired. Please log in again.");
      }
    }
  }, [user, today, reloadShifts, logout]);

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
      setAuthError(IDLE_LOGOUT_MESSAGE);
    };
    const resetTimer = () => {
      api.recordActivity();
      clearTimeout(timer);
      timer = setTimeout(handleIdle, IDLE_LOGOUT_MS);
    };
    // Backstop for the case a live in-page timer can't cover: the tab gets
    // backgrounded/the device sleeps for longer than the timeout, and the
    // browser throttles or fully suspends timers while it's not visible —
    // `handleIdle` above might never fire on its own. Checked the instant
    // the app is visible/focused again, against the real elapsed time
    // (not the timer's), so a stale session is caught right away instead
    // of surviving until the next mouse move or tap.
    const checkStaleOnResume = () => {
      const lastActivity = api.getLastActivity();
      if (lastActivity !== null && Date.now() - lastActivity >= IDLE_LOGOUT_MS) {
        handleIdle();
      }
    };

    const activityEvents = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "wheel"] as const;
    activityEvents.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));
    document.addEventListener("visibilitychange", checkStaleOnResume);
    window.addEventListener("focus", checkStaleOnResume);
    window.addEventListener("pageshow", checkStaleOnResume);
    resetTimer();

    return () => {
      clearTimeout(timer);
      activityEvents.forEach((evt) => window.removeEventListener(evt, resetTimer));
      document.removeEventListener("visibilitychange", checkStaleOnResume);
      window.removeEventListener("focus", checkStaleOnResume);
      window.removeEventListener("pageshow", checkStaleOnResume);
    };
  }, [status, logout]);

  // Left to throw on failure (e.g. wrong password) so the confirmation dialog can show the
  // error inline instead of routing it through the top-level action-error banner.
  const deleteAccount = useCallback(async (password: string) => {
    await api.deleteAccount(password);
    api.clearToken();
    api.clearRememberedEmail();
    api.clearLastActivity();
    setUser(null);
    setShifts([]);
    setDayExpenses([]);
    setWeekExtras([]);
    setShiftsLoaded(false);
    setStatus("loggedOut");
    hideEarningsNow();
  }, [hideEarningsNow]);

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
      refresh,
      earningsHidden,
      revealEarnings,
      hideEarningsNow,
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
      refresh,
      earningsHidden,
      revealEarnings,
      hideEarningsNow,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
