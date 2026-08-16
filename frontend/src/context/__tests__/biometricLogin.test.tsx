// @vitest-environment jsdom
//
// End-to-end coverage of AppContext's biometric-login wiring, driven through
// the real <App /> the same way deviceLimitNotice.test.tsx exercises the
// device-limit notice: a real provider, a real shell, real navigation. What
// changes between tests is the mocked platform/biometricAuth boundary (the
// native Swift plugin can't run in this sandbox — see nativeBiometricAuth
// .test.ts for that translation layer's own coverage) and lib/api.
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "../AppContext";
import type { BiometricAuthenticateResult, BiometricCapabilities, BiometricStatus } from "../../platform/biometricAuth";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getToken: vi.fn(() => null),
    setToken: vi.fn(),
    clearToken: vi.fn(),
    isRemembered: vi.fn(() => true),
    recordActivity: vi.fn(),
    getLastActivity: vi.fn(() => null),
    clearLastActivity: vi.fn(),
    getRememberedEmail: vi.fn(() => null),
    setRememberedEmail: vi.fn(),
    clearRememberedEmail: vi.fn(),
    login: vi.fn(),
    signup: vi.fn(),
    fetchMe: vi.fn(),
    fetchMeWithToken: vi.fn(),
    changePassword: vi.fn(),
    logout: vi.fn(async () => {}),
    listSessions: vi.fn(async () => ({ sessions: [] })),
    listShifts: vi.fn(async () => ({ shifts: [] })),
    listDayExpenses: vi.fn(async () => ({ expenses: [] })),
    listWeekExtras: vi.fn(async () => ({ extras: [] })),
    // Only reached if WakingUpScreen actually mounts (see the white-screen
    // regression test below) — every other test in this file resolves fast
    // enough that useDelayedFlag's 500ms never trips, so WakingUpScreen (and
    // therefore useHealthWakeup/pingHealth) never mounts at all. Left
    // permanently pending here rather than resolved: the test only cares
    // that the screen *shows up*, not about its internal health-check phase.
    pingHealth: vi.fn(() => new Promise<boolean>(() => {})),
  };
});

vi.mock("../../platform/biometricAuth", () => ({
  checkBiometricCapabilities: vi.fn(),
  getBiometricStatus: vi.fn(),
  enableBiometricLogin: vi.fn(),
  authenticateWithBiometrics: vi.fn(),
  disableBiometricLogin: vi.fn(),
}));

import * as api from "../../lib/api";
import * as biometricAuth from "../../platform/biometricAuth";
import App from "../../App";

const apiFetchMeWithToken = api.fetchMeWithToken as unknown as ReturnType<typeof vi.fn>;
const apiGetToken = api.getToken as unknown as ReturnType<typeof vi.fn>;
const apiSetToken = api.setToken as unknown as ReturnType<typeof vi.fn>;
const apiLogin = api.login as unknown as ReturnType<typeof vi.fn>;
const apiChangePassword = api.changePassword as unknown as ReturnType<typeof vi.fn>;
const apiLogout = api.logout as unknown as ReturnType<typeof vi.fn>;

const checkCapabilities = biometricAuth.checkBiometricCapabilities as unknown as ReturnType<typeof vi.fn>;
const getStatus = biometricAuth.getBiometricStatus as unknown as ReturnType<typeof vi.fn>;
const authenticate = biometricAuth.authenticateWithBiometrics as unknown as ReturnType<typeof vi.fn>;
const enableBiometric = biometricAuth.enableBiometricLogin as unknown as ReturnType<typeof vi.fn>;
const disableBiometric = biometricAuth.disableBiometricLogin as unknown as ReturnType<typeof vi.fn>;

const USER = {
  id: "u1",
  name: "Sam Lee",
  email: "sam@example.com",
  address: "",
  workLocationName: "",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: 1,
  rate: 20,
  goalHours: 40,
  goalEarnings: 800,
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

const FACE_ID_AVAILABLE: BiometricCapabilities = { kind: "faceId", enrolled: true };
const FACE_ID_ENABLED: BiometricStatus = { enabled: true, accountId: "u1", accountLabel: "Sam Lee", kind: "faceId" };
const NOT_ENABLED: BiometricStatus = { enabled: false };

function success(token = "recovered-token"): BiometricAuthenticateResult {
  return { outcome: "success", token, accountId: "u1" };
}

/** The mobile welcome screen (see WelcomeScreen.tsx) now appears before
 * every login, in front of AuthScreen — dismissed here via its
 * always-present "Get started" button so the rest of this file can keep
 * asserting directly against the login form/icon, exactly as it did before
 * that screen existed. Only ever needed after a render that mounts the real
 * <App /> — the RememberMeHarness-based tests further down render just the
 * harness directly, bypassing Root()/WelcomeScreen entirely, so they never
 * need this. Not needed either for a cold-launch attempt that lands
 * straight on "loggedIn" without ever passing through "loggedOut" (see
 * WelcomeScreen's own gating in App.tsx's Root). */
async function skipWelcomeScreen() {
  fireEvent.click(await screen.findByRole("button", { name: "Get started" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  apiGetToken.mockReturnValue(null);
  checkCapabilities.mockResolvedValue(FACE_ID_AVAILABLE);
  getStatus.mockResolvedValue(NOT_ENABLED);
  disableBiometric.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("cold-launch automatic biometric prompt", () => {
  it("never fires when biometric login was never enabled", async () => {
    render(<App />);
    await skipWelcomeScreen();
    await screen.findByRole("button", { name: "Log in" });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("signs the user straight in on a successful prompt, without ever showing the login form", async () => {
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    authenticate.mockResolvedValue(success("tok-abc"));
    apiFetchMeWithToken.mockResolvedValue({ user: USER });

    render(<App />);

    await screen.findByRole("navigation", { name: "Main" });
    expect(authenticate).toHaveBeenCalledOnce();
    expect(apiFetchMeWithToken).toHaveBeenCalledWith("tok-abc");
    expect(api.setToken).toHaveBeenCalledWith("tok-abc", false);
  });

  // Regression coverage for the "white screen after Face ID on a cold
  // backend" bug: Root() used to keep WakingUpScreen suppressed for the
  // *entire* attemptBiometricAuthentication operation (biometricBusy),
  // including the fetchMeWithToken() re-validation call that follows a
  // successful native prompt — so once the system Face ID sheet dismissed,
  // there was nothing on screen at all for however long a cold Render
  // instance took to answer. Root() now uses the narrower
  // biometricPromptActive flag (true only for the native prompt itself),
  // so WakingUpScreen is free to show during that wait. See App.tsx's
  // Root() and AppContext's biometricPromptActive doc comments.
  it("shows the waking-up screen (not a blank one) while the post-unlock backend re-validation is still in flight", async () => {
    getStatus.mockResolvedValue(FACE_ID_ENABLED);

    let resolveAuthenticate: (result: BiometricAuthenticateResult) => void = () => {};
    authenticate.mockImplementation(
      () => new Promise<BiometricAuthenticateResult>((resolve) => { resolveAuthenticate = resolve; })
    );
    let resolveFetchMe: (v: { user: typeof USER }) => void = () => {};
    apiFetchMeWithToken.mockImplementation(
      () => new Promise((resolve) => { resolveFetchMe = resolve; })
    );

    render(<App />);
    await waitFor(() => expect(authenticate).toHaveBeenCalledOnce());

    // While the native Face ID/Touch ID sheet itself would still be up,
    // the screen intentionally stays blank rather than showing "Getting
    // Wage Tracker ready" underneath it — see biometricPromptActive's own
    // doc comment. Not asserted here beyond letting the 500ms grace delay
    // elapse with nothing resolved yet; the real assertion is the state
    // change below.
    resolveAuthenticate({ outcome: "success", token: "tok-abc", accountId: "u1" });

    // The prompt has now resolved successfully, but fetchMeWithToken() (the
    // backend re-validation of the recovered token) is still pending —
    // exactly the gap the bug lived in. WakingUpScreen must appear once the
    // 500ms grace window passes, not stay blank.
    await screen.findByText(/Getting Wage Tracker ready/, {}, { timeout: 2000 });

    resolveFetchMe({ user: USER });
    await screen.findByRole("navigation", { name: "Main" });
  });

  it("falls back to the login screen with no error banner on cancellation", async () => {
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    authenticate.mockResolvedValue({ outcome: "failed", reason: "user_cancelled" });

    render(<App />);
    await skipWelcomeScreen();

    await screen.findByRole("button", { name: "Log in" });
    expect(apiFetchMeWithToken).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
    // The manual-retry icon is still offered — biometrics is still enabled,
    // only this one attempt was cancelled.
    expect(screen.getByRole("button", { name: /Sign in with Face ID/ })).toBeTruthy();
  });

  it("shows a specific error for a genuine failure (not a cancel)", async () => {
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    authenticate.mockResolvedValue({
      outcome: "failed",
      reason: "lockout",
      error: "Face ID is temporarily locked. Use your device passcode, or sign in with your password.",
    });

    render(<App />);
    await skipWelcomeScreen();

    await screen.findByText(/temporarily locked/);
  });

  it("clears the stored credential and hides the icon when the device's biometry enrollment changed", async () => {
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    authenticate.mockResolvedValue({ outcome: "failed", reason: "credential_invalidated", error: "enrollment changed" });

    render(<App />);
    await skipWelcomeScreen();

    await screen.findByRole("button", { name: "Log in" });
    expect(screen.queryByRole("button", { name: /Sign in with/ })).toBeNull();
  });

  it("attempts at most once automatically, even though React StrictMode double-invokes effects", async () => {
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    authenticate.mockResolvedValue({ outcome: "failed", reason: "authentication_failed", error: "no match" });

    render(<App />);
    await skipWelcomeScreen();

    await screen.findByRole("button", { name: "Log in" });
    // A second render tick (StrictMode's double effect invocation runs
    // inside this same act()/render already) must not have queued a second
    // prompt — this is the one thing the ref guard exists to prevent.
    await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
  });

  it("clears the credential and explains itself when the recovered token fails backend validation (401)", async () => {
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    authenticate.mockResolvedValue(success("stale-token"));
    const { ApiError } = await import("../../lib/api");
    apiFetchMeWithToken.mockRejectedValue(new ApiError("Invalid or expired token", 401));

    render(<App />);
    await skipWelcomeScreen();

    await screen.findByText(/saved sign-in has expired/i);
    expect(disableBiometric).toHaveBeenCalledOnce();
    expect(api.setToken).not.toHaveBeenCalled();
  });

  it("does NOT clear the credential on a generic (non-401) backend validation error", async () => {
    // A dropped connection or a momentarily-unreachable backend is not the
    // same thing as an actually-invalid token — the recovered credential is
    // still perfectly good, and clearing it here would silently turn
    // biometric login off over nothing more than a network blip. Mirrors
    // the same "only drop the session on an actual auth failure" principle
    // `restoreSession`'s ordinary-token path already follows for `fetchMe`.
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    authenticate.mockResolvedValue(success("recovered-token"));
    apiFetchMeWithToken.mockRejectedValue(new Error("Network request failed"));

    render(<App />);
    await skipWelcomeScreen();

    await screen.findByText(/Couldn't verify your saved sign-in/);
    expect(disableBiometric).not.toHaveBeenCalled();
    // The Face ID icon must still be offered afterward — nothing about
    // biometric status was touched by this failure.
    expect(screen.getByRole("button", { name: /Sign in with Face ID/ })).toBeTruthy();
  });

  it("shows no error banner and leaves biometric login enabled after an interrupted (backgrounded) prompt", async () => {
    // Same AppContext-level condition as the "cancelled" case above
    // (`reason !== "user_cancelled" && reason !== "app_backgrounded"`),
    // exercised directly here rather than only at the native-adapter
    // translation layer (see nativeBiometricAuth.test.ts) — an incoming
    // call or switching apps mid-prompt is exactly as ordinary an outcome
    // as the user tapping Cancel, and must be treated identically.
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    authenticate.mockResolvedValue({ outcome: "failed", reason: "app_backgrounded" });

    render(<App />);
    await skipWelcomeScreen();

    await screen.findByRole("button", { name: /Sign in with Face ID/ });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(disableBiometric).not.toHaveBeenCalled();
  });
});

describe("manual retry icon", () => {
  it("re-attempts after an automatic prompt was cancelled, independent of the once-per-launch guard", async () => {
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    authenticate.mockResolvedValueOnce({ outcome: "failed", reason: "user_cancelled" });
    render(<App />);
    await skipWelcomeScreen();
    const icon = await screen.findByRole("button", { name: /Sign in with Face ID/ });
    expect(authenticate).toHaveBeenCalledTimes(1);

    authenticate.mockResolvedValueOnce(success("tok-retry"));
    apiFetchMeWithToken.mockResolvedValue({ user: USER });
    const user = userEvent.setup();
    await user.click(icon);

    await screen.findByRole("navigation", { name: "Main" });
    expect(authenticate).toHaveBeenCalledTimes(2);
  });
});

describe("concurrent biometric attempts never race each other", () => {
  it("a manual retry while the automatic cold-launch prompt is still in flight does not start a second native prompt", async () => {
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    apiGetToken.mockReturnValue(null);

    // Never resolves until this test explicitly settles it — simulates a
    // native Face ID sheet that's still up on screen, mid-prompt.
    let resolveAuthenticate: (result: BiometricAuthenticateResult) => void = () => {};
    authenticate.mockImplementation(
      () => new Promise<BiometricAuthenticateResult>((resolve) => { resolveAuthenticate = resolve; })
    );

    const user = userEvent.setup();
    render(
      <AppProvider>
        <RememberMeHarness />
      </AppProvider>
    );

    // The automatic cold-launch attempt fires on mount (no ordinary token,
    // biometrics enabled per the mocks above) and hangs on the promise
    // above, exactly like a native Face ID sheet still being up.
    await waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));

    // The harness's retry button has no `disabled` attribute (unlike the
    // real login screen's icon, which AuthScreen already disables while
    // `biometricBusy` — see BiometricLoginSettings for the same pattern on
    // the enable side) — clicking it here exercises the underlying guard
    // directly, standing in for a double-tap landing before React's next
    // render, or the automatic prompt and a manual retry racing each other.
    await user.click(screen.getByText("retry biometric"));
    await user.click(screen.getByText("retry biometric"));

    // Still exactly one native call — the two manual retries above must
    // have bailed out immediately rather than starting a second (or third)
    // concurrent prompt.
    expect(authenticate).toHaveBeenCalledTimes(1);

    resolveAuthenticate({ outcome: "failed", reason: "user_cancelled" });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loggedOut"));
  });
});

/** Exposes just enough of AppContext to drive this scenario without going
 * through the Settings screen's biometric toggle, which only renders behind
 * `Capacitor.isNativePlatform()` (see BiometricLoginSettings.tsx) — false in
 * jsdom, same as every other test in this file already works around for the
 * things it needs to reach directly. What's under test here is AppContext's
 * own contract (`enableBiometricLogin` demoting the persisted session), not
 * that specific button. */
function RememberMeHarness() {
  const { status, biometricStatus, login, enableBiometricLogin, logout, retryBiometricLogin } = useApp();
  const [lastResult, setLastResult] = useState<string>("");
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="biometric-enabled">{String(biometricStatus.enabled)}</div>
      <div data-testid="last-enable-result">{lastResult}</div>
      <button type="button" onClick={() => void login(USER.email, "correct horse battery staple", true)}>
        log in (remember me)
      </button>
      <button
        type="button"
        onClick={() =>
          void enableBiometricLogin().then((result) => setLastResult(JSON.stringify(result)))
        }
      >
        enable biometrics
      </button>
      <button type="button" onClick={() => void logout()}>
        log out
      </button>
      <button type="button" onClick={() => void retryBiometricLogin()}>
        retry biometric
      </button>
    </div>
  );
}

describe("Remember Me and biometric login", () => {
  it("Remember Me enabled -> enable Face ID -> restart -> Face ID is required", async () => {
    // A minimal stand-in for the real native token adapter's persistence
    // contract (see platform/nativeSecureTokenStorage.ts): setToken(token,
    // remember) is the only thing that changes what a later getToken() call
    // — standing in here for "the next cold launch" — returns.
    let persisted: { token: string; remembered: boolean } | null = null;
    apiSetToken.mockImplementation(async (token: string, remember: boolean) => {
      persisted = { token, remembered: remember };
    });
    apiGetToken.mockImplementation(() => (persisted?.remembered ? persisted.token : null));

    checkCapabilities.mockResolvedValue(FACE_ID_AVAILABLE);
    getStatus.mockResolvedValue(NOT_ENABLED);
    apiLogin.mockResolvedValue({ token: "ordinary-token", user: USER });

    const user = userEvent.setup();
    const { unmount } = render(
      <AppProvider>
        <RememberMeHarness />
      </AppProvider>
    );

    await user.click(screen.getByText("log in (remember me)"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loggedIn"));

    // Logging in with Remember Me checked persists the ordinary session —
    // the baseline this test needs to prove biometrics changes.
    expect(persisted).toEqual({ token: "ordinary-token", remembered: true });

    // Enabling Face ID succeeds (mocked, since there's no real Face ID
    // hardware here) and reports the account is now biometric-enabled, same
    // as isEnabled() would report on the device after BiometricAuthPlugin's
    // `enable` writes its Keychain items.
    enableBiometric.mockResolvedValue({ outcome: "enabled", kind: "faceId" });
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    await user.click(screen.getByText("enable biometrics"));
    await waitFor(() => expect(enableBiometric).toHaveBeenCalled());

    // The requirement under test: turning Face ID on must demote the
    // ordinary persisted session, not leave it sitting in Keychain
    // alongside the new biometric credential. If this token were still
    // "remembered", the next cold launch would restore straight through it
    // and never reach the biometric prompt at all.
    expect(persisted).toEqual({ token: "ordinary-token", remembered: false });

    // Simulate a cold launch: unmount entirely (nothing here survives
    // process death) and mount a fresh provider — getToken() now reflects
    // exactly what a real restart would see, driven by the same `persisted`
    // state the calls above just changed, not a value hand-set for this
    // step.
    unmount();
    authenticate.mockResolvedValue({ outcome: "failed", reason: "user_cancelled" });

    render(
      <AppProvider>
        <RememberMeHarness />
      </AppProvider>
    );

    // Face ID is required: the cold-launch restore effect finds no ordinary
    // token (persisted.remembered is now false) and attempts biometric
    // auth automatically, rather than silently restoring the old session.
    await waitFor(() => expect(authenticate).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loggedOut"));
  });

  it("rolls back the credential and reports a typed failure when demoting the session storage fails", async () => {
    // First setToken call is login's own remember-me persist (must succeed
    // so the test reaches an authenticated state); the second is the
    // demotion call `enableBiometricLoginAction` makes after the native
    // credential is created — that's the one this test forces to reject,
    // simulating a Keychain write failure (device locked, storage full,
    // simultaneous access, etc.).
    apiSetToken.mockResolvedValueOnce(undefined);
    apiSetToken.mockRejectedValueOnce(new Error("Keychain busy"));
    apiGetToken.mockReturnValue("ordinary-token");

    checkCapabilities.mockResolvedValue(FACE_ID_AVAILABLE);
    getStatus.mockResolvedValue(NOT_ENABLED);
    apiLogin.mockResolvedValue({ token: "ordinary-token", user: USER });
    enableBiometric.mockResolvedValue({ outcome: "enabled", kind: "faceId" });

    const user = userEvent.setup();
    render(
      <AppProvider>
        <RememberMeHarness />
      </AppProvider>
    );

    await user.click(screen.getByText("log in (remember me)"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loggedIn"));

    // No .catch() sits between this click and enableBiometricLogin()'s
    // returned promise (see RememberMeHarness above) — if the storage
    // failure weren't caught inside AppContext, this would surface here as
    // an unhandled rejection and fail the test, exactly like the real
    // BiometricLoginSettings.tsx call site would blow up in production.
    await user.click(screen.getByText("enable biometrics"));

    // A typed failure result with a readable message comes back instead of
    // the call throwing.
    await waitFor(() =>
      expect(screen.getByTestId("last-enable-result").textContent).toBe(
        JSON.stringify({
          outcome: "failed",
          reason: "keychain_error",
          error: "Couldn't finish turning on biometric sign-in. Please try again.",
        })
      )
    );

    // The native credential `enableBiometricLogin` just created is rolled
    // back — it must not survive a transaction that ultimately failed.
    expect(disableBiometric).toHaveBeenCalled();

    // Biometric status must not read as enabled after a failed transaction.
    expect(screen.getByTestId("biometric-enabled").textContent).toBe("false");

    // The user's existing authenticated session remains safe and
    // consistent — a storage failure while demoting must not also log them
    // out.
    expect(screen.getByTestId("status").textContent).toBe("loggedIn");
  });
});

describe("Log out is a soft lock when biometric login is enabled", () => {
  it("does not revoke the session or clear the credential, and Face ID signs back in", async () => {
    // Same minimal persistence stand-in as the Remember Me describe block
    // above — what matters here is that the token this test's mocked
    // `api.logout` would otherwise revoke keeps working after logout.
    let persisted: { token: string; remembered: boolean } | null = null;
    apiSetToken.mockImplementation(async (token: string, remember: boolean) => {
      persisted = { token, remembered: remember };
    });
    apiGetToken.mockImplementation(() => (persisted?.remembered ? persisted.token : null));

    checkCapabilities.mockResolvedValue(FACE_ID_AVAILABLE);
    getStatus.mockResolvedValue(NOT_ENABLED);
    apiLogin.mockResolvedValue({ token: "ordinary-token", user: USER });
    enableBiometric.mockResolvedValue({ outcome: "enabled", kind: "faceId" });

    const user = userEvent.setup();
    render(
      <AppProvider>
        <RememberMeHarness />
      </AppProvider>
    );

    await user.click(screen.getByText("log in (remember me)"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loggedIn"));

    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    await user.click(screen.getByText("enable biometrics"));
    await waitFor(() => expect(screen.getByTestId("biometric-enabled").textContent).toBe("true"));

    await user.click(screen.getByText("log out"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loggedOut"));

    // The whole point of the soft lock: the backend session is left valid
    // (no server-side revoke call) and the biometric credential is left in
    // place (no disable call), unlike the old "logout always fully signs
    // out" behavior.
    expect(apiLogout).not.toHaveBeenCalled();
    expect(disableBiometric).not.toHaveBeenCalled();
    expect(screen.getByTestId("biometric-enabled").textContent).toBe("true");

    // Prove it actually still works end-to-end, not just that the flags
    // look right: Face ID recovers the same token that was never revoked,
    // and the backend accepts it.
    authenticate.mockResolvedValue(success("ordinary-token"));
    apiFetchMeWithToken.mockResolvedValue({ user: USER });
    await user.click(screen.getByText("retry biometric"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loggedIn"));
  });

  it("still fully signs out (server revoke + credential clear) when biometric login was never enabled", async () => {
    apiGetToken.mockReturnValue(null);
    checkCapabilities.mockResolvedValue(FACE_ID_AVAILABLE);
    getStatus.mockResolvedValue(NOT_ENABLED);
    apiLogin.mockResolvedValue({ token: "ordinary-token", user: USER });

    const user = userEvent.setup();
    render(
      <AppProvider>
        <RememberMeHarness />
      </AppProvider>
    );

    await user.click(screen.getByText("log in (remember me)"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loggedIn"));

    await user.click(screen.getByText("log out"));
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loggedOut"));

    expect(apiLogout).toHaveBeenCalled();
    expect(disableBiometric).toHaveBeenCalled();
  });
});

async function logInNormally(user: ReturnType<typeof userEvent.setup>) {
  await skipWelcomeScreen();
  apiLogin.mockResolvedValue({ token: "ordinary-token", user: USER });
  await user.type(await screen.findByLabelText("Email"), USER.email);
  await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
  await user.click(screen.getByRole("button", { name: "Log in" }));
  await screen.findByRole("navigation", { name: "Main" });
}

describe("session-ending actions clear the stored biometric credential", () => {
  it("logout", async () => {
    const user = userEvent.setup();
    render(<App />);
    await logInNormally(user);

    await user.click(screen.getByRole("button", { name: "Log out" }));
    const popup = await screen.findByRole("alertdialog");
    await user.click(within(popup).getByRole("button", { name: /^(log out|yes|confirm)/i }));

    // Logging out returns to "loggedOut" — the welcome screen reappears
    // here too (see WelcomeScreen's own doc comment: every time before
    // login, not just the very first launch), so it needs dismissing again
    // before the login form is reachable.
    await skipWelcomeScreen();
    await waitFor(() => expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy());
    expect(disableBiometric).toHaveBeenCalled();
  });

  it("password change", async () => {
    apiChangePassword.mockResolvedValue({ token: "new-token" });
    const user = userEvent.setup();
    render(<App />);
    await logInNormally(user);

    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("button", { name: "Settings" }));
    await user.click(screen.getByRole("button", { name: /Security/ }));
    await user.type(screen.getByLabelText("Current password"), "correct horse battery staple");
    await user.type(screen.getByLabelText("New password"), "a different long passphrase");
    await user.type(screen.getByLabelText("Confirm new password"), "a different long passphrase");
    await user.click(screen.getByRole("button", { name: "Change password" }));

    await waitFor(() => expect(apiChangePassword).toHaveBeenCalled());
    await waitFor(() => expect(disableBiometric).toHaveBeenCalled());
  });
});
