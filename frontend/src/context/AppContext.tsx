import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { addDays, isoDate, startOfWeek } from "../lib/date";
import { settleViewportBeforeAuth } from "../lib/viewportHeight";
import type { SessionInfo } from "../lib/api";
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
// Matches SESSION_IDLE_TIMEOUT_MS on the server (see
// backend/src/security/sessionPolicy.ts). The server is now the one that
// actually enforces this — an idle session stops authenticating there, so a
// stolen token is no longer protected only by the honour system of a
// cooperative browser. This client-side copy still exists so the app can log
// itself out cleanly and explain why, rather than waiting for the next
// request to fail with a bare 401. Keep the two numbers in step: a longer
// value here just means the user meets an unexplained 401 first.
const IDLE_LOGOUT_MS = 10 * 60 * 1000;
const IDLE_LOGOUT_MESSAGE =
  "You were logged out after 10 minutes of inactivity. Any shift in progress kept counting — log back in to see it.";

// How long a manual "reveal" of the earnings-privacy toggle lasts before it
// auto-hides again — a flat window from the moment of reveal, not an idle
// timer, so it hides itself right on schedule even while the app is in
// active use (see revealEarnings below).
const EARNINGS_REVEAL_MS = 20 * 60 * 1000;

// On mobile, submitting the login/signup form happens while the on-screen
// keyboard is still open, so the authenticated shell would otherwise mount
// against a viewport that is still mid-animation. `settleViewportBeforeAuth`
// (lib/viewportHeight.ts) blurs the field, waits for the visual viewport to
// stop moving — a quiet period, not the first resize event, which on iOS is
// only an intermediate frame of the keyboard animation — and publishes the
// settled height before we flip status. It returns immediately when there's
// no software keyboard in play (desktop, or a token auto-login), so neither
// of those pays any delay for it. Both login and signup use it: they are the
// same transition and hit the same bug.

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
  logout: () => Promise<void>;
  clearAuthError: () => void;
  /** A server-side explanation the user needs to see once after a *successful*
   * login — today only the device-limit eviction notice. Distinct from
   * `authError` (a failed login) on purpose: this login worked. */
  sessionNotice: string | null;
  dismissSessionNotice: () => void;
  updateSettings: (patch: api.MePatch) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  deleteAccount: (password: string) => Promise<void>;

  sessions: SessionInfo[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  loadSessions: () => Promise<void>;
  revokeSession: (sessionId: string) => Promise<void>;
  revokeOtherSessions: () => Promise<void>;

  today: Date;
  shifts: Shift[];
  shiftsLoading: boolean;
  shiftsLoaded: boolean;
  createShift: (input: api.ShiftInput) => Promise<Shift | undefined>;
  /** Throwing variants, for callers that show the failure inline next to the
   * values that failed rather than in the global banner — today the History
   * day editor. The swallowing versions above are right for Entry, whose
   * fields autosave on change and have nowhere local to put a message. */
  createShiftOrThrow: (input: api.ShiftInput) => Promise<Shift>;
  updateShiftOrThrow: (id: string, patch: Partial<api.ShiftInput>) => Promise<Shift>;
  removeShiftOrThrow: (id: string) => Promise<void>;
  updateShift: (id: string, patch: Partial<api.ShiftInput>) => Promise<Shift | undefined>;
  removeShift: (id: string) => Promise<void>;

  dayExpenses: DayExpense[];
  setFuelCost: (date: string, fuelCost: number | null) => Promise<void>;
  setFuelCostOrThrow: (date: string, fuelCost: number | null) => Promise<void>;

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
  // Held in provider state rather than in the screen that shows it, for two
  // reasons. It arrives on the login response, before the authenticated
  // shell that displays it has mounted. And it must survive tab switches
  // inside that shell without ever reappearing: it is cleared when the user
  // dismisses it and on logout, and set nowhere else, so navigating away and
  // back cannot resurrect it (see the regression test).
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [dayExpenses, setDayExpenses] = useState<DayExpense[]>([]);
  const [weekExtras, setWeekExtras] = useState<WeekExtra[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
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

  const clearTokenSafely = useCallback(async () => {
    try {
      await api.clearToken();
    } catch (error) {
      // Native secure storage can fail asynchronously. Authentication state
      // must still settle without an unhandled promise rejection; each caller
      // is also revoking, deleting, or responding to an invalid server session.
      console.error("Could not clear the stored authentication token", error);
    }
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restoreSession = async () => {
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
        await clearTokenSafely();
        if (cancelled) return;
        api.clearLastActivity();
        setStatus("loggedOut");
        setAuthError(IDLE_LOGOUT_MESSAGE);
        return;
      }

      try {
        const { user } = await api.fetchMe();
        if (cancelled) return;
        setUser(user);
        api.recordActivity();
        setStatus("loggedIn");
      } catch (e) {
        // Only drop the session on an actual auth failure. A network blip or a
        // momentarily-unreachable backend shouldn't force the user to log back in.
        if (e instanceof ApiError && e.status === 401) {
          await clearTokenSafely();
        }
        if (cancelled) return;
        setStatus("loggedOut");
      }
    };

    void restoreSession();
    return () => { cancelled = true; };
  }, [clearTokenSafely]);

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
    // Cleared up front so a notice from an earlier session can never be
    // mistaken for something this login caused.
    setSessionNotice(null);
    // Started BEFORE the request, deliberately, and run alongside it. This
    // backend cold-starts, so a login can easily take longer than the
    // viewport guard's maximum hold; kicking the transition off only after
    // the response arrived meant the keyboard had been closing, unwatched,
    // for the whole wait. Now the blur and the guard happen immediately and
    // the two run concurrently, so a slow response costs nothing extra and
    // the guard is never older than the request it's protecting.
    const viewportReady = settleViewportBeforeAuth();
    try {
      const { token, user, notice } = await api.login(email, password);
      await api.setToken(token, remember);
      api.recordActivity();
      if (remember) api.setRememberedEmail(email);
      else api.clearRememberedEmail();
      setUser(user);
      // The backend has been sending this since the device-limit feature
      // landed; the client destructured it away and it never reached a
      // screen. `?? null` normalises the ordinary-login case (field absent)
      // so the value is always one of string | null rather than undefined.
      setSessionNotice(notice ?? null);
      hideEarningsNow();
      await viewportReady;
      setStatus("loggedIn");
    } catch (e) {
      // Nothing to clean up on the viewport side: the promise always
      // resolves, and the guard releases itself once iOS reports the real
      // viewport again (or on the next orientation change).
      await viewportReady;
      setAuthError(e instanceof Error ? e.message : "Could not log in");
    } finally {
      setAuthBusy(false);
    }
  }, [hideEarningsNow]);

  const signup = useCallback(async (input: api.SignupInput) => {
    setAuthBusy(true);
    setAuthError(null);
    // Same ordering as login above, and for the same reason.
    const viewportReady = settleViewportBeforeAuth();
    try {
      const { token, user } = await api.signup(input);
      await api.setToken(token, true);
      api.recordActivity();
      setUser(user);
      hideEarningsNow();
      await viewportReady;
      setStatus("loggedIn");
    } catch (e) {
      await viewportReady;
      setAuthError(e instanceof Error ? e.message : "Could not create account");
    } finally {
      setAuthBusy(false);
    }
  }, [hideEarningsNow]);

  const logout = useCallback(async () => {
    // Best-effort server-side revocation of the current session, fired
    // before the token is cleared below (so it still has a valid
    // Authorization header to send) but never awaited: a network failure,
    // an already-expired token, or the session already being revoked by
    // some other means must never prevent the *local* logout from
    // completing. Start it before awaiting secure-storage cleanup so it can
    // still build its Authorization header from the current token.
    const serverLogout = api.logout().catch(() => {});
    await clearTokenSafely();
    api.clearLastActivity();
    setUser(null);
    setShifts([]);
    setDayExpenses([]);
    setWeekExtras([]);
    setShiftsLoaded(false);
    setSessions([]);
    setSessionNotice(null);
    setStatus("loggedOut");
    hideEarningsNow();
    void serverLogout;
  }, [clearTokenSafely, hideEarningsNow]);

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
        await logout();
        setAuthError("Your session expired. Please log in again.");
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
      void logout().then(() => setAuthError(IDLE_LOGOUT_MESSAGE));
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
    await clearTokenSafely();
    api.clearRememberedEmail();
    api.clearLastActivity();
    setUser(null);
    setShifts([]);
    setDayExpenses([]);
    setWeekExtras([]);
    setShiftsLoaded(false);
    setStatus("loggedOut");
    hideEarningsNow();
  }, [clearTokenSafely, hideEarningsNow]);

  // Shared handling for authenticated actions (settings/shifts): an expired or invalid
  // token logs the user out with a clear reason instead of failing silently; any other
  // failure (validation, network) surfaces as a dismissible message instead of an
  // unhandled promise rejection.
  const handleActionError = useCallback(
    async (e: unknown, fallback: string) => {
      if (e instanceof ApiError && e.status === 401) {
        await logout();
        setAuthError("Your session expired. Please log in again.");
        return;
      }
      setActionError(e instanceof Error ? e.message : fallback);
    },
    [logout]
  );

  // Left to throw on any failure — including validation and network errors —
  // so the Settings UI can tell a genuine save from a failed one and never
  // show "Saved" when nothing actually changed server-side (see
  // SettingsScreen/the settings/* section components). The one exception is
  // an expired/invalid session: that's still handled here (logout + the
  // top-level actionError banner) exactly like every other authenticated
  // action, since the Settings screen itself is about to unmount in that
  // case anyway and has nothing useful to show inline. The error is
  // rethrown even then so a caller mid-`await` never mistakes it for success.
  const updateSettings = useCallback(
    async (patch: api.MePatch): Promise<void> => {
      try {
        const { user } = await api.patchMe(patch);
        setUser(user);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await logout();
          setAuthError("Your session expired. Please log in again.");
        }
        throw e;
      }
    },
    [logout]
  );

  // Left to throw on failure (wrong current password, weak new password, etc.)
  // so the Settings form can show the error inline, same pattern as deleteAccount.
  // On success, the new session token replaces the old one in whichever storage
  // (localStorage vs sessionStorage) the current session was already using —
  // see api.isRemembered — so a "remember me" session stays remembered and a
  // session-only one doesn't suddenly start surviving a browser restart.
  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const { token } = await api.changePassword(currentPassword, newPassword);
    await api.setToken(token, api.isRemembered());
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const { sessions } = await api.listSessions();
      setSessions(sessions);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await logout();
        setAuthError("Your session expired. Please log in again.");
        return;
      }
      setSessionsError(e instanceof Error ? e.message : "Couldn't load sessions");
    } finally {
      setSessionsLoading(false);
    }
  }, [logout]);

  // Left to throw on failure so the Settings UI can show the error inline —
  // same pattern as changePassword/deleteAccount. If the session revoked was
  // this very device's current one, the backend says so via `revokedCurrent`
  // and the app logs itself out right away rather than waiting for some
  // later request to fail with a generic 401.
  const revokeSession = useCallback(
    async (sessionId: string) => {
      const { revokedCurrent } = await api.revokeSession(sessionId);
      if (revokedCurrent) {
        await logout();
        return;
      }
      await loadSessions();
    },
    [logout, loadSessions]
  );

  const revokeOtherSessions = useCallback(async () => {
    await api.revokeOtherSessions();
    await loadSessions();
  }, [loadSessions]);

  // Shared 401 handling for the throwing variants: an expired session still
  // logs out and explains itself globally, exactly as it does everywhere
  // else, and the error is rethrown so the caller mid-await never mistakes
  // it for success. Same pattern as updateSettings above.
  const rethrowingAction = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T> => {
      try {
        return await run();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await logout();
          setAuthError("Your session expired. Please log in again.");
        }
        throw e;
      }
    },
    [logout]
  );

  const createShiftOrThrow = useCallback(
    (input: api.ShiftInput) =>
      rethrowingAction(async () => {
        const { shift } = await api.createShift(input);
        setShifts((prev) => [...prev, shift]);
        return shift;
      }),
    [rethrowingAction]
  );

  const updateShiftOrThrow = useCallback(
    (id: string, patch: Partial<api.ShiftInput>) =>
      rethrowingAction(async () => {
        const { shift } = await api.patchShift(id, patch);
        setShifts((prev) => prev.map((s) => (s.id === id ? shift : s)));
        return shift;
      }),
    [rethrowingAction]
  );

  const removeShiftOrThrow = useCallback(
    (id: string) =>
      rethrowingAction(async () => {
        await api.deleteShift(id);
        setShifts((prev) => prev.filter((s) => s.id !== id));
      }),
    [rethrowingAction]
  );

  const createShift = useCallback(
    async (input: api.ShiftInput) => {
      try {
        const { shift } = await api.createShift(input);
        setShifts((prev) => [...prev, shift]);
        return shift;
      } catch (e) {
        await handleActionError(e, "Couldn't save shift");
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
        await handleActionError(e, "Couldn't update shift");
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
        await handleActionError(e, "Couldn't remove shift");
      }
    },
    [handleActionError]
  );

  // Optimistic — the amount box is meant to feel instant like everything else on
  // this screen. Rolls back to the previous value if the request fails.
  const setFuelCostOrThrow = useCallback(
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
        throw e;
      }
    },
    [dayExpenses]
  );

  const setFuelCost = useCallback(
    async (date: string, fuelCost: number | null) => {
      try {
        await setFuelCostOrThrow(date, fuelCost);
      } catch (e) {
        await handleActionError(e, "Couldn't save fuel cost");
      }
    },
    [setFuelCostOrThrow, handleActionError]
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
          await handleActionError(e, "Couldn't save other earnings");
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
      sessionNotice,
      dismissSessionNotice: () => setSessionNotice(null),
      updateSettings,
      changePassword,
      deleteAccount,
      sessions,
      sessionsLoading,
      sessionsError,
      loadSessions,
      revokeSession,
      revokeOtherSessions,
      today,
      shifts,
      shiftsLoading,
      shiftsLoaded,
      createShift,
      updateShift,
      removeShift,
      createShiftOrThrow,
      updateShiftOrThrow,
      removeShiftOrThrow,
      dayExpenses,
      setFuelCost,
      setFuelCostOrThrow,
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
      sessionNotice,
      login,
      signup,
      logout,
      updateSettings,
      changePassword,
      deleteAccount,
      sessions,
      sessionsLoading,
      sessionsError,
      loadSessions,
      revokeSession,
      revokeOtherSessions,
      today,
      shifts,
      shiftsLoading,
      shiftsLoaded,
      createShift,
      updateShift,
      removeShift,
      createShiftOrThrow,
      updateShiftOrThrow,
      removeShiftOrThrow,
      dayExpenses,
      setFuelCost,
      setFuelCostOrThrow,
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
