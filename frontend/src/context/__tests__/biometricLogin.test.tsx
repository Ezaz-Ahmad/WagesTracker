// @vitest-environment jsdom
//
// End-to-end coverage of AppContext's biometric-login wiring, driven through
// the real <App /> the same way deviceLimitNotice.test.tsx exercises the
// device-limit notice: a real provider, a real shell, real navigation. What
// changes between tests is the mocked platform/biometricAuth boundary (the
// native Swift plugin can't run in this sandbox — see nativeBiometricAuth
// .test.ts for that translation layer's own coverage) and lib/api.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const apiLogin = api.login as unknown as ReturnType<typeof vi.fn>;
const apiChangePassword = api.changePassword as unknown as ReturnType<typeof vi.fn>;

const checkCapabilities = biometricAuth.checkBiometricCapabilities as unknown as ReturnType<typeof vi.fn>;
const getStatus = biometricAuth.getBiometricStatus as unknown as ReturnType<typeof vi.fn>;
const authenticate = biometricAuth.authenticateWithBiometrics as unknown as ReturnType<typeof vi.fn>;
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

  it("falls back to the login screen with no error banner on cancellation", async () => {
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    authenticate.mockResolvedValue({ outcome: "failed", reason: "user_cancelled" });

    render(<App />);

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

    await screen.findByText(/temporarily locked/);
  });

  it("clears the stored credential and hides the icon when the device's biometry enrollment changed", async () => {
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    authenticate.mockResolvedValue({ outcome: "failed", reason: "credential_invalidated", error: "enrollment changed" });

    render(<App />);

    await screen.findByRole("button", { name: "Log in" });
    expect(screen.queryByRole("button", { name: /Sign in with/ })).toBeNull();
  });

  it("attempts at most once automatically, even though React StrictMode double-invokes effects", async () => {
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    authenticate.mockResolvedValue({ outcome: "failed", reason: "authentication_failed", error: "no match" });

    render(<App />);

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

    await screen.findByText(/saved sign-in has expired/i);
    expect(disableBiometric).toHaveBeenCalledOnce();
    expect(api.setToken).not.toHaveBeenCalled();
  });
});

describe("manual retry icon", () => {
  it("re-attempts after an automatic prompt was cancelled, independent of the once-per-launch guard", async () => {
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    authenticate.mockResolvedValueOnce({ outcome: "failed", reason: "user_cancelled" });
    render(<App />);
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

async function logInNormally(user: ReturnType<typeof userEvent.setup>) {
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
