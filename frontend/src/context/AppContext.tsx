import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { addDays, isoDate, startOfWeek } from "../lib/date";
import { settleViewportBeforeAuth } from "../lib/viewportHeight";
import type { SessionInfo } from "../lib/api";
import type { DayExpense, Shift, User, WeekExtra } from "../lib/types";
import { getConnectivityStatus, subscribeConnectivity } from "../platform/connectivity";
import { subscribeAppResume } from "../platform/appLifecycle";
import { AutomaticRefreshGate } from "../platform/automaticRefresh";
import {
  checkBiometricCapabilities,
  getBiometricStatus,
  enableBiometricLogin as adapterEnableBiometricLogin,
  authenticateWithBiometrics,
  disableBiometricLogin as adapterDisableBiometricLogin,
  type BiometricCapabilities,
  type BiometricEnableResult,
  type BiometricFailureReason,
  type BiometricStatus,
} from "../platform/biometricAuth";

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

/**
 * Fallback copy for a failed biometric attempt when the platform adapter
 * didn't supply its own message (the native adapter normally does — see
 * `describeLaError` in `ios/App/App/BiometricAuthPlugin.swift` — this only
 * matters for `unknown_error`/an adapter that omits `error`). Cancellation
 * and app-backgrounding are handled by the caller before this is ever
 * reached, since neither should show an error at all.
 */
function describeBiometricFailure(reason: BiometricFailureReason): string {
  switch (reason) {
    case "authentication_failed":
      return "Face ID or Touch ID did not recognize you.";
    case "unavailable":
      return "Face ID or Touch ID isn't available on this device.";
    case "not_enrolled":
      return "Face ID or Touch ID is not set up on this device.";
    case "lockout":
      return "Face ID or Touch ID is temporarily locked. Use your device passcode, or sign in with your password.";
    case "credential_invalidated":
      return "Your device's biometric enrollment changed. Sign in with your password, then re-enable biometric login in Settings.";
    case "keychain_error":
      return "Couldn't read the stored biometric credential.";
    default:
      return "Biometric sign-in failed.";
  }
}

type Status = "loading" | "loggedOut" | "loggedIn";

interface AppContextValue {
  status: Status;
  user: User | null;
  authError: string | null;
  authBusy: boolean;
  actionError: string | null;
  connected: boolean;
  retryConnectivity: () => Promise<void>;
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

  /** Device capability (Face ID / Touch ID / none, enrolled or not) — native
   * iOS only; always `{ kind: "none", enrolled: false, ... }` on web/PWA, so
   * Settings and the login screen can decide whether to render anything at
   * all without checking platform directly. See platform/biometricAuth.ts. */
  biometricCapabilities: BiometricCapabilities;
  /** Non-prompting "is biometric login currently on for this device" — a
   * DEVICE-level fact, not an account-level one (see `BiometricStatus`'s own
   * doc comment on why `enabled` alone can be true for a different account
   * than the one currently relevant). The login screen, which doesn't know
   * a logged-in `user` yet, does its own comparison against `biometricStatus.email`;
   * Settings should use `isBiometricEnabledForCurrentUser` below instead of
   * this raw value. */
  biometricStatus: BiometricStatus;
  /** `biometricStatus.enabled` narrowed to "...and it's actually *this*
   * logged-in account's credential, not a different account's left
   * occupying the device's single credential slot." `false` while logged
   * out (nothing to compare against) — see `biometricStatus`'s doc comment.
   * Settings (`BiometricLoginSettings`) uses this instead of the raw
   * `biometricStatus.enabled` so it can never show "Turn off Face ID" for
   * an account that doesn't actually have it on. */
  isBiometricEnabledForCurrentUser: boolean;
  /** True while a biometric prompt (enable or authenticate) is in flight —
   * used to disable the Settings toggle and the login-screen icon so a
   * second tap can't start a second concurrent prompt. */
  biometricBusy: boolean;
  /** True only while the native Face ID/Touch ID system sheet is actually
   * up — a narrower window than `biometricBusy`. `Root()` in App.tsx uses
   * this (not `biometricBusy`) to decide whether to show the "waking the
   * server" screen during the automatic cold-launch Face ID attempt: it
   * must stay hidden while this is true (the system prompt is already the
   * thing on screen) but must NOT stay hidden once this goes false again,
   * even though `biometricBusy` is still true for the backend
   * re-validation that follows a successful unlock. */
  biometricPromptActive: boolean;
  /** Set by a failed/cancelled automatic or manual biometric login attempt;
   * distinct from `authError` (a failed password login) so retrying with a
   * password doesn't show a stale biometric message and vice versa. */
  biometricLoginError: string | null;
  clearBiometricLoginError: () => void;
  /** Must only be called while logged in. Prompts Face ID/Touch ID
   * immediately; only stores a credential if that prompt succeeds. Never
   * throws — the result tells the caller (SecuritySettings) what happened,
   * since "the user cancelled" is an expected outcome, not an exception. */
  enableBiometricLogin: () => Promise<BiometricEnableResult>;
  /** Clears the stored credential. Safe to call even when nothing is
   * stored. */
  disableBiometricLogin: () => Promise<void>;
  /** Manual retry from the login screen's Face ID/Touch ID icon — the same
   * underlying attempt as the automatic cold-launch prompt, just user-
   * triggered instead, so it isn't gated by the "once per launch" guard. */
  retryBiometricLogin: () => Promise<void>;

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
  const [connected, setConnected] = useState(true);
  const connectedRef = useRef(true);
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

  const [biometricCapabilities, setBiometricCapabilities] = useState<BiometricCapabilities>({
    kind: "none",
    enrolled: false,
  });
  const [biometricStatus, setBiometricStatus] = useState<BiometricStatus>({ enabled: false });
  const [biometricBusy, setBiometricBusy] = useState(false);
  // Narrower than biometricBusy — true only while the native Face ID/Touch
  // ID system sheet itself is actually up, not for the rest of
  // attemptBiometricAuthentication's work (re-validating the recovered
  // token against the backend). See Root() in App.tsx: it must not show the
  // "waking the server" screen while the system biometric prompt is on
  // screen (that would be confusing), but it must show it — same as an
  // ordinary password login — for the network wait that follows, which can
  // be the same 30-60s Render cold-start wait either way. Using the wider
  // biometricBusy for that second condition used to leave the app on a
  // blank white screen for the entire cold-start wait after a successful
  // Face ID unlock, with nothing telling the user anything was happening.
  const [biometricPromptActive, setBiometricPromptActive] = useState(false);
  const [biometricLoginError, setBiometricLoginError] = useState<string | null>(null);
  // Gates the *automatic* cold-launch prompt to at most once per app load —
  // a fresh value every time this module/provider is freshly instantiated,
  // i.e. exactly once per real cold launch. The manual retry action (the
  // login screen's icon) deliberately does not check this ref: cancelling
  // the automatic prompt and then tapping the icon must be able to trigger a
  // second, explicitly-requested one.
  const autoBiometricAttemptedRef = useRef(false);

  // Guards against two biometric operations (a sign-in attempt and/or an
  // enable attempt) running concurrently. `biometricBusy` state exists for
  // the UI to disable its own button while a prompt is in flight, but a
  // React state update is not synchronous — a rapid double-tap can land
  // before the button re-renders as disabled, and the automatic cold-launch
  // prompt and a manually-tapped retry icon could in principle race each
  // other too. A plain ref check-and-set closes that gap: it's synchronous,
  // so the second of two near-simultaneous calls always sees it already set
  // and bails out before ever starting a second native prompt or a second
  // concurrent backend call.
  const biometricOperationInFlightRef = useRef(false);

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

  // Shared by every session-ending action (logout, password change, account
  // deletion) and by a failed post-biometric backend validation. Always safe
  // to call even when nothing is stored — the native adapter's disable() is
  // itself unconditional (see NativeBiometricAuthAdapter/BiometricAuthPlugin
  // .disable) — so every caller here can fire it defensively rather than
  // first checking whether biometrics was ever turned on.
  const clearBiometricCredential = useCallback(async () => {
    await adapterDisableBiometricLogin();
    setBiometricStatus({ enabled: false });
    // Best-effort unmark of the idle-timeout exemption and the 5-year
    // lifetime upgrade (see setSessionBiometricProtection's own comment) —
    // frequently has no session left that can actually authenticate this
    // call (e.g. a failed Face ID validation already means the recovered
    // token itself just 401'd), which is fine: a session that can't
    // authenticate at all doesn't need rotating back to start behaving
    // ordinarily again. When it does succeed, the call revokes the current
    // session as part of rotating it back onto the ordinary 30-day
    // lifetime, so the returned replacement token must be applied right
    // away — the live app would otherwise be left holding a token this same
    // call just revoked, in whichever persistence mode it was already in
    // (never forced to session-only here; that demotion is a deliberate,
    // separate step only enableBiometricLoginAction's own success path
    // performs).
    try {
      const { token: reverted } = await api.setSessionBiometricProtection(false);
      await api.setToken(reverted, api.isRemembered());
    } catch (error) {
      console.error("Could not clear this session's biometric-protection flag", error);
    }
  }, []);

  // Loads device capability + on/off status once at startup, independent of
  // auth state — the login screen needs `biometricStatus` while logged out
  // (to decide whether to show the Face ID/Touch ID icon at all) just as
  // much as Settings needs it while logged in.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [capabilities, status] = await Promise.all([checkBiometricCapabilities(), getBiometricStatus()]);
      if (cancelled) return;
      setBiometricCapabilities(capabilities);
      setBiometricStatus(status);
    })();
    return () => { cancelled = true; };
  }, []);

  /**
   * Shared by the automatic cold-launch prompt below and the login screen's
   * manual retry icon (`retryBiometricLogin`). Prompts biometrics via the
   * platform adapter and, only on a genuine success, re-validates the
   * recovered token against the backend (`fetchMeWithToken`) before ever
   * treating it as the active session — biometrics supplements backend
   * session validation here, it never replaces it. Returns whether it
   * resulted in a signed-in session, so the cold-launch restore effect below
   * knows not to also fall through to its own "loggedOut" branch.
   */
  const attemptBiometricAuthentication = useCallback(async (): Promise<boolean> => {
    if (biometricOperationInFlightRef.current) {
      // Already mid-prompt — e.g. a double-tap on the login screen's icon
      // beating React's disabled-button re-render, or the automatic
      // cold-launch attempt and a manual retry racing each other. Never
      // start a second concurrent native prompt/backend call; the one
      // already running will settle `status`/`biometricStatus` on its own.
      return false;
    }
    biometricOperationInFlightRef.current = true;
    setBiometricBusy(true);
    setBiometricLoginError(null);
    try {
      let result;
      setBiometricPromptActive(true);
      try {
        result = await authenticateWithBiometrics();
      } finally {
        // Cleared the moment the system sheet itself is done, success or
        // not — everything from here on (re-validating the token against
        // the backend below) is an ordinary network wait, not something the
        // "don't show the waking-up screen over the Face ID prompt" guard
        // in Root() needs to keep suppressing.
        setBiometricPromptActive(false);
      }
      if (result.outcome !== "success" || !result.token) {
        // Cancellation and an interrupted (backgrounded) prompt are ordinary,
        // expected outcomes — the user simply lands back on the normal
        // login screen with nothing to explain. Everything else gets a
        // specific, readable message instead of silently doing nothing.
        const reason = result.reason;
        if (reason && reason !== "user_cancelled" && reason !== "app_backgrounded") {
          setBiometricLoginError(result.error ?? describeBiometricFailure(reason));
        }
        if (reason === "credential_invalidated") {
          // The plugin already deleted its own Keychain entries in this case
          // (device biometric enrollment changed) — this just brings the JS
          // side in sync so the login screen's icon disappears instead of
          // offering a retry that can never succeed.
          setBiometricStatus({ enabled: false });
        }
        return false;
      }

      try {
        const { user } = await api.fetchMeWithToken(result.token);
        // Session-only (remember=false), independent of whatever the
        // ordinary Remember Me setting is — see the module doc comment
        // above AppProvider... a biometric-recovered session is its own
        // persistence path, gated by a fresh Face ID/Touch ID check on the
        // *next* cold launch rather than by silently surviving one the way
        // an ordinary Remember Me session does.
        await api.setToken(result.token, false);
        api.recordActivity();
        setUser(user);
        hideEarningsNow();
        setStatus("loggedIn");
        return true;
      } catch (e) {
        const sessionInvalid = e instanceof ApiError && e.status === 401;
        if (sessionInvalid) {
          // The recovered token is actually expired, revoked, or the
          // account no longer exists — clear the now-useless stored
          // credential rather than leaving it to fail the exact same way
          // on every future launch.
          await clearBiometricCredential();
        }
        // A network failure or a momentarily-unreachable backend must not
        // clear a perfectly good credential just because this one check
        // couldn't complete — the same principle `restoreSession`'s
        // ordinary-token path below already follows for `fetchMe()`
        // ("Only drop the session on an actual auth failure"). Losing Face
        // ID over a dropped connection would be a worse outcome than just
        // asking the user to try again.
        setBiometricLoginError(
          sessionInvalid
            ? "Your saved sign-in has expired. Please log in again."
            : "Couldn't verify your saved sign-in. Please log in again."
        );
        return false;
      }
    } finally {
      setBiometricBusy(false);
      biometricOperationInFlightRef.current = false;
    }
  }, [hideEarningsNow, clearBiometricCredential]);

  useEffect(() => {
    const timer = setInterval(() => setToday(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const restoreSession = async () => {
      const token = api.getToken();
      if (!token) {
        // No ordinary (Remember Me / session-only) token to restore — the
        // one moment biometric login actually does something. Gated to at
        // most once per cold launch by the ref, and only even attempted when
        // a credential is actually stored, so a device that never enabled
        // biometrics never sees so much as a capability check delay itself
        // here. See the "once per launch" reasoning on the ref's own comment.
        if (!autoBiometricAttemptedRef.current) {
          autoBiometricAttemptedRef.current = true;
          const status = await getBiometricStatus();
          if (cancelled) return;
          if (status.enabled) {
            const loggedIn = await attemptBiometricAuthentication();
            if (cancelled || loggedIn) return;
          }
        }
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
  }, [clearTokenSafely, attemptBiometricAuthentication]);

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
    if (biometricStatus.enabled) {
      // With biometric login on, "Log out" is deliberately a soft lock, not
      // a full account sign-out: the backend session is left valid and the
      // biometric credential is left in place, so Face ID/Touch ID can sign
      // the same session straight back in from the login screen — exactly
      // like closing and reopening the app already does. Revoking the
      // session here would kill the very token that credential unlocks,
      // turning every post-logout Face ID attempt into a guaranteed
      // "your saved sign-in has expired" failure instead of signing back
      // in, which is worse than not offering it at all.
      //
      // Only the local, ordinary token is cleared, so the app still returns
      // to the login screen and requires re-authentication (biometric or
      // password) to continue. A user who wants this device to stop trusting
      // the account entirely still has "Log out all other devices" and
      // per-session revoke in Settings → Security → Sessions, and turning
      // biometric login off itself clears this credential via the existing
      // disable path.
      await clearTokenSafely();
    } else {
      // No biometric credential is at stake — logout can, and should, fully
      // end the session: best-effort server-side revocation, fired before
      // the token is cleared below (so it still has a valid Authorization
      // header to send) but never awaited, since a network failure or an
      // already-expired token must never prevent the *local* logout from
      // completing.
      const serverLogout = api.logout().catch(() => {});
      await clearTokenSafely();
      // Defensive: covers a credential that exists in storage but hasn't
      // been reflected into `biometricStatus` state yet (e.g. a status
      // check still in flight). Safe and cheap to call unconditionally —
      // disable() is itself a no-op when nothing is stored.
      await clearBiometricCredential();
      void serverLogout;
    }
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
  }, [biometricStatus.enabled, clearTokenSafely, clearBiometricCredential, hideEarningsNow]);

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

  const automaticRefreshGateRef = useRef(new AutomaticRefreshGate());
  const refreshOnce = useCallback((): Promise<void> => {
    return automaticRefreshGateRef.current.trigger(refresh);
  }, [refresh]);
  const refreshOnceRef = useRef(refreshOnce);
  useEffect(() => { refreshOnceRef.current = refreshOnce; }, [refreshOnce]);

  useEffect(() => {
    let previous = true;
    return subscribeConnectivity((next) => {
      connectedRef.current = next.connected;
      setConnected(next.connected);
      if (!previous && next.connected) void refreshOnceRef.current();
      previous = next.connected;
    });
  }, []);

  useEffect(() => {
    if (status !== "loggedIn") return;
    return subscribeAppResume(() => {
      // fetchMe inside refresh is the authoritative session revalidation.
      // Network status only suppresses an obviously futile request; it never
      // decides whether a session is valid or logs the user out.
      if (connectedRef.current) void refreshOnceRef.current();
    });
  }, [status]);

  const retryConnectivity = useCallback(async () => {
    try {
      const next = await getConnectivityStatus();
      connectedRef.current = next.connected;
      setConnected(next.connected);
      if (next.connected) await refreshOnceRef.current();
    } catch {
      setActionError("Couldn't check the connection. Please try again.");
    }
  }, []);

  // Idle auto-logout: resets on any real interaction while logged in, and
  // signs out (with an explanatory message on the login screen) if none
  // arrives within IDLE_LOGOUT_MS. A closed tab/browser has the same effect
  // for non-"remember me" sessions already, since those live in
  // sessionStorage and are gone the moment the tab closes.
  //
  // Skipped entirely while biometric login is enabled: this timer forces a
  // *local* logout purely from the client's own clock, with no server round
  // trip — but a biometric-protected session (see
  // setSessionBiometricProtection/enableBiometricLoginAction above) is
  // specifically exempt from the server's own idle timeout, on the theory
  // that Face ID/Touch ID re-entry on this device substitutes for it. If
  // this timer still fired locally regardless, it would force exactly the
  // "signed out just for leaving the app alone for 10 minutes" experience
  // the exemption exists to prevent — the resume-triggered `refresh()`
  // effect above is the one that actually asks the server, and the server
  // will now keep saying this session is still valid.
  useEffect(() => {
    if (status !== "loggedIn" || biometricStatus.enabled) return;

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
  }, [status, logout, biometricStatus.enabled]);

  // Left to throw on failure (e.g. wrong password) so the confirmation dialog can show the
  // error inline instead of routing it through the top-level action-error banner.
  const deleteAccount = useCallback(async (password: string) => {
    await api.deleteAccount(password);
    await clearTokenSafely();
    // The account itself no longer exists — a leftover biometric credential
    // would just fail its post-unlock backend validation on the next launch
    // anyway, but there is no reason to leave a dead credential sitting in
    // the Keychain (or, worse, silently succeed a stale unlock if this
    // device is ever handed to someone else who signs up with the same
    // slot before the OS ever asks about it again).
    await clearBiometricCredential();
    api.clearRememberedEmail();
    api.clearLastActivity();
    setUser(null);
    setShifts([]);
    setDayExpenses([]);
    setWeekExtras([]);
    setShiftsLoaded(false);
    setStatus("loggedOut");
    hideEarningsNow();
  }, [clearTokenSafely, clearBiometricCredential, hideEarningsNow]);

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
    // The backend already revoked every session (including the one a
    // biometric credential might have been storing a token for) and issued
    // a fresh one — see routes/me.ts's PATCH /password. Clearing here rather
    // than silently re-storing the new token means the user consciously
    // re-enables biometric login after changing their password instead of
    // it quietly carrying on with a token they never approved for that
    // purpose.
    await clearBiometricCredential();
  }, [clearBiometricCredential]);

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
    // Deliberately does NOT touch this device's own biometric credential:
    // "log out all other devices" never revokes the current session, so
    // whatever token this device's credential is storing is still good. If
    // biometrics is enabled on one of the *other* devices being revoked
    // here, there's no cross-device Keychain to reach into and clear
    // directly (sync is off — see nativeSecureTokenStorage's
    // setSynchronize(false) — by design, so a compromised device can't pull
    // another device's credential either). That device's own next biometric
    // unlock re-validates against the backend (attemptBiometricAuthentication
    // above) and clears itself the moment that validation 401s — the same
    // mechanism that handles a revoked/expired session for any other reason.
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

  // Must only be called while logged in (Settings, the only caller, is
  // itself only reachable while authenticated). Never throws: cancelling or
  // failing the Face ID/Touch ID prompt is an expected, ordinary outcome —
  // "keep the setting off" — not an exceptional one, so the result object
  // is how SecuritySettings finds out what happened, same pattern as
  // setWeekExtra above returning a boolean rather than throwing on a
  // validation failure.
  const enableBiometricLoginAction = useCallback(async (): Promise<BiometricEnableResult> => {
    const token = api.getToken();
    if (!user || !token) {
      return {
        outcome: "failed",
        reason: "unavailable",
        error: "You must be logged in to enable biometric login.",
      };
    }
    if (biometricOperationInFlightRef.current) {
      // Shares the same in-flight guard as attemptBiometricAuthentication:
      // an enable prompt and a sign-in prompt must never run concurrently
      // either — both drive the single native Face ID/Touch ID sheet and
      // the same `biometricBusy` UI flag, so a race between them would be
      // just as unsafe as a double sign-in attempt.
      return {
        outcome: "failed",
        reason: "unavailable",
        error: "A biometric prompt is already in progress. Please wait and try again.",
      };
    }
    biometricOperationInFlightRef.current = true;
    setBiometricBusy(true);
    let rotatedToBiometric = false;
    try {
      // Best-effort: try to upgrade this session onto the 5-year
      // biometric-protected lifetime *before* prompting Face ID/Touch ID, so
      // the credential the native prompt is about to store is already the
      // long-lived token. A JWT's own expiry can't be extended after it's
      // signed (see BIOMETRIC_SESSION_TTL_MS on the backend), so there is no
      // way to upgrade it after the fact without also updating whatever
      // Face ID already stored — and this plugin has no "update without
      // re-prompting" method (see BiometricAuthPlugin.swift). A failure here
      // is not fatal to turning Face ID on at all: the prompt below still
      // runs with whichever token is on hand, just capped at the ordinary
      // 30-day session length until the next successful call.
      let tokenForCredential = token;
      try {
        const { token: rotated } = await api.setSessionBiometricProtection(true);
        tokenForCredential = rotated;
        rotatedToBiometric = true;
        // Keeps the live app working under the new session id right away,
        // in whatever persistence mode it was already in — not yet the
        // "biometrics replaces Remember Me" demotion below, just making
        // sure nothing breaks if the user backgrounds the app before the
        // Face ID prompt resolves, since the session this token replaced
        // was revoked the instant the call above succeeded.
        await api.setToken(rotated, api.isRemembered());
      } catch (error) {
        console.error(
          "Could not upgrade this session onto the biometric-protected lifetime before enabling Face ID",
          error
        );
      }

      const result = await adapterEnableBiometricLogin(user.id, user.name, user.email, tokenForCredential);
      if (result.outcome === "enabled") {
        // Biometrics becomes the persistent unlock method from here on — an
        // ordinary Remember-Me-persisted token left in Keychain alongside it
        // would let the *next* cold launch restore straight into the app
        // through `restoreSession`'s "has a token" branch, before biometrics
        // ever gets a chance to run (see the top of that effect below). That
        // would make turning Face ID on a no-op in exactly the case it's
        // supposed to matter — Remember Me was already on.
        //
        // `setToken(tokenForCredential, false)` re-stores the *same* token
        // Face ID just saved as session-only: the native adapter's in-memory
        // `session` field is updated (so the account already running right
        // now stays signed in, nothing about the live session changes), but
        // the Keychain entry that would have survived a cold launch is
        // deleted. On the next cold launch `api.getToken()` is therefore
        // null, which is exactly the branch `restoreSession` uses to attempt
        // biometric auto-login — biometrics becomes the only path back in
        // without re-entering a password. A no-op when Remember Me was
        // already off.
        //
        // Web is unaffected: the web adapter's `enable()` always resolves
        // "failed" (see platform/biometricAuth.ts), so this branch is
        // unreachable there, and the Settings toggle itself never renders
        // outside Capacitor.isNativePlatform() in the first place.
        //
        // This is a two-step transaction — the native credential already
        // exists at this point — so a failure here cannot just propagate:
        // `enableBiometricLogin`'s documented contract is "never throws",
        // and leaving the just-created Keychain credential in place while
        // the session failed to demote would report biometrics as "on"
        // while a stale persisted token still sits in Keychain too, exactly
        // the inconsistent state Fix 2 above exists to prevent.
        try {
          await api.setToken(tokenForCredential, false);
        } catch (storageError) {
          console.error("Could not demote the persisted session while enabling biometric login", storageError);
          // Roll back: delete the credential `adapterEnableBiometricLogin`
          // just wrote, and — since the session was upgraded above — rotate
          // it back onto the ordinary lifetime too, via
          // `clearBiometricCredential` (which does both). Its own
          // `disable()` call is already best-effort/non-throwing by
          // contract (see NativeBiometricAuthAdapter.disable and the web
          // adapter's no-op) — the `.catch` below is a second line of
          // defense in case a future adapter doesn't honor that, so this
          // rollback can never itself produce an unhandled rejection on top
          // of the original failure.
          await clearBiometricCredential().catch((rollbackError) => {
            console.error("Could not roll back the biometric credential after a storage failure", rollbackError);
          });
          return {
            outcome: "failed",
            reason: "keychain_error",
            error: "Couldn't finish turning on biometric sign-in. Please try again.",
          };
        }
        setBiometricStatus(await getBiometricStatus());
      } else if (rotatedToBiometric) {
        // The Face ID/Touch ID prompt itself failed or was cancelled after
        // the session was already upgraded above — roll that back rather
        // than silently leaving an ordinary logged-in session idle-exempt
        // and 5-years-lived with no biometric gate actually protecting it.
        // Safe to call even though `enable()` never stored anything:
        // `clearBiometricCredential`'s own `disable()` is an unconditional
        // no-op when there's nothing to remove.
        await clearBiometricCredential().catch((rollbackError) => {
          console.error("Could not roll back the session upgrade after a failed biometric enable", rollbackError);
        });
      }
      return result;
    } finally {
      setBiometricBusy(false);
      biometricOperationInFlightRef.current = false;
    }
  }, [user, clearBiometricCredential]);

  const retryBiometricLoginAction = useCallback(async (): Promise<void> => {
    await attemptBiometricAuthentication();
  }, [attemptBiometricAuthentication]);

  const clearBiometricLoginError = useCallback(() => setBiometricLoginError(null), []);

  // See isBiometricEnabledForCurrentUser's own doc comment on AppContextValue.
  // `accountId` is compared, not `email` — it's the stable identifier
  // (`user.id`) rather than something a user could theoretically change; a
  // missing/empty accountId (a credential stored before this field existed,
  // or before biometrics was ever enabled at all) never matches a real
  // logged-in user's id, so this fails closed by construction rather than
  // needing an explicit "is this legacy data" branch.
  const isBiometricEnabledForCurrentUser = biometricStatus.enabled && !!user && biometricStatus.accountId === user.id;

  const value = useMemo<AppContextValue>(
    () => ({
      status,
      user,
      authError,
      authBusy,
      actionError,
      connected,
      retryConnectivity,
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
      biometricCapabilities,
      biometricStatus,
      isBiometricEnabledForCurrentUser,
      biometricBusy,
      biometricPromptActive,
      biometricLoginError,
      clearBiometricLoginError,
      enableBiometricLogin: enableBiometricLoginAction,
      disableBiometricLogin: clearBiometricCredential,
      retryBiometricLogin: retryBiometricLoginAction,
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
      connected,
      retryConnectivity,
      sessionNotice,
      login,
      signup,
      logout,
      updateSettings,
      changePassword,
      deleteAccount,
      biometricCapabilities,
      biometricStatus,
      isBiometricEnabledForCurrentUser,
      biometricBusy,
      biometricPromptActive,
      biometricLoginError,
      clearBiometricLoginError,
      enableBiometricLoginAction,
      clearBiometricCredential,
      retryBiometricLoginAction,
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
