// @vitest-environment jsdom
//
// Regression coverage for the "Face ID quietly stops working after 10
// minutes of the app just sitting there" issue: the idle-auto-logout timer
// in AppContext.tsx used to fire purely from the client's own clock,
// regardless of whether biometric login was enabled — so even a device with
// Face ID on got signed all the way out (soft-lock or not) the instant 10
// minutes passed, defeating the point of biometrics as a persistent unlock
// method. The fix is two-layered: the backend now exempts a
// "biometric_protected" session from its own idle timeout (see
// backend/test/session-idle.test.ts), and the frontend's *own* proactive
// idle timer — which never even asks the server — is skipped entirely while
// biometricStatus.enabled is true, deferring instead to the resume-triggered
// refresh() call to ask the server, which now keeps saying the session is
// still valid.
//
// This file exercises only the frontend half (the local timer itself); the
// server-side exemption has its own dedicated backend test coverage.
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "../AppContext";
import type { BiometricEnableResult, BiometricStatus } from "../../platform/biometricAuth";

// Must match AppContext.tsx's own (unexported) IDLE_LOGOUT_MS.
const IDLE_LOGOUT_MS = 10 * 60 * 1000;

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
    setSessionBiometricProtection: vi.fn(async () => ({ token: "rotated-token" })),
  };
});

vi.mock("../../platform/biometricAuth", () => ({
  checkBiometricCapabilities: vi.fn(async () => ({ kind: "faceId", enrolled: true })),
  getBiometricStatus: vi.fn(async () => ({ enabled: false })),
  enableBiometricLogin: vi.fn(),
  authenticateWithBiometrics: vi.fn(),
  disableBiometricLogin: vi.fn(async () => {}),
}));

vi.mock("../../platform/shiftNotifications", () => ({
  getPendingEndShift: vi.fn(async () => null),
  clearPendingEndShift: vi.fn(async () => {}),
  postShiftStartedNotification: vi.fn(async () => ({ ok: true })),
  clearShiftNotification: vi.fn(async () => {}),
}));

import * as api from "../../lib/api";
import * as biometricAuth from "../../platform/biometricAuth";

const apiLogin = api.login as unknown as ReturnType<typeof vi.fn>;
const apiGetToken = api.getToken as unknown as ReturnType<typeof vi.fn>;
const apiSetToken = api.setToken as unknown as ReturnType<typeof vi.fn>;
const apiSetSessionBiometricProtection = api.setSessionBiometricProtection as unknown as ReturnType<typeof vi.fn>;
const getStatus = biometricAuth.getBiometricStatus as unknown as ReturnType<typeof vi.fn>;
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

const NOT_ENABLED: BiometricStatus = { enabled: false };
const FACE_ID_ENABLED: BiometricStatus = { enabled: true, accountId: "u1", accountLabel: "Sam Lee", kind: "faceId" };

function Harness() {
  const { status, biometricStatus, login, enableBiometricLogin, disableBiometricLogin } = useApp();
  const [lastEnableResult, setLastEnableResult] = useState<string>("");
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="biometric-enabled">{String(biometricStatus.enabled)}</div>
      <button type="button" onClick={() => void login(USER.email, "correct horse battery staple", true)}>
        log in
      </button>
      <button
        type="button"
        onClick={() => void enableBiometricLogin().then((r: BiometricEnableResult) => setLastEnableResult(r.outcome))}
      >
        enable biometrics
      </button>
      <div data-testid="enable-result">{lastEnableResult}</div>
      <button type="button" onClick={() => void disableBiometricLogin()}>
        disable biometrics
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getStatus.mockResolvedValue(NOT_ENABLED);
  disableBiometric.mockResolvedValue(undefined);
  apiSetSessionBiometricProtection.mockResolvedValue({ token: "rotated-token" });
  // enableBiometricLoginAction reads api.getToken() directly (the current
  // in-memory token, regardless of "remembered" status) to hand to the
  // native adapter — a stateful stand-in so it reflects whatever login()
  // actually stored, rather than the default `null` every other mock in
  // this file gets away with because nothing else here calls getToken().
  let currentToken: string | null = null;
  apiSetToken.mockImplementation(async (token: string) => {
    currentToken = token;
  });
  apiGetToken.mockImplementation(() => currentToken);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function logIn(user: ReturnType<typeof userEvent.setup>) {
  apiLogin.mockResolvedValue({ token: "ordinary-token", user: USER });
  render(
    <AppProvider>
      <Harness />
    </AppProvider>
  );
  await user.click(screen.getByText("log in"));
  await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loggedIn"));
}

describe("idle auto-logout timer respects biometric-login status", () => {
  it("still signs out after 10 idle minutes when biometric login is off (baseline, unchanged)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await logIn(user);

    await vi.advanceTimersByTimeAsync(IDLE_LOGOUT_MS + 1000);

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loggedOut"));
  });

  it("does NOT sign out after 10 idle minutes once biometric login is enabled", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await logIn(user);

    enableBiometric.mockResolvedValue({ outcome: "enabled", kind: "faceId" });
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    await user.click(screen.getByText("enable biometrics"));
    await waitFor(() => expect(screen.getByTestId("biometric-enabled").textContent).toBe("true"));

    await vi.advanceTimersByTimeAsync(IDLE_LOGOUT_MS + 1000);

    // Give any stray microtask a chance to resolve, then confirm status
    // genuinely never moved off loggedIn — not merely "hasn't yet".
    await vi.advanceTimersByTimeAsync(IDLE_LOGOUT_MS);
    expect(screen.getByTestId("status").textContent).toBe("loggedIn");
  });

  it("resumes the idle timer immediately after biometric login is turned back off", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await logIn(user);

    enableBiometric.mockResolvedValue({ outcome: "enabled", kind: "faceId" });
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    await user.click(screen.getByText("enable biometrics"));
    await waitFor(() => expect(screen.getByTestId("biometric-enabled").textContent).toBe("true"));

    await user.click(screen.getByText("disable biometrics"));
    await waitFor(() => expect(screen.getByTestId("biometric-enabled").textContent).toBe("false"));

    await vi.advanceTimersByTimeAsync(IDLE_LOGOUT_MS + 1000);
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loggedOut"));
  });

  it("marks the session biometric-protected server-side when biometric login is enabled", async () => {
    const user = userEvent.setup();
    await logIn(user);

    enableBiometric.mockResolvedValue({ outcome: "enabled", kind: "faceId" });
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    await user.click(screen.getByText("enable biometrics"));

    await waitFor(() => expect(apiSetSessionBiometricProtection).toHaveBeenCalledWith(true));
  });

  it("unmarks the session server-side when biometric login is disabled", async () => {
    const user = userEvent.setup();
    await logIn(user);

    await user.click(screen.getByText("disable biometrics"));

    await waitFor(() => expect(apiSetSessionBiometricProtection).toHaveBeenCalledWith(false));
  });

  it("still reports biometric login as enabled even if marking the session protected server-side fails", async () => {
    // Best-effort by design — Face ID itself already fully works at this
    // point (the Keychain credential exists); a failure to mark the idle
    // exemption must not be reported as the enable() call having failed.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    await logIn(user);

    apiSetSessionBiometricProtection.mockRejectedValueOnce(new Error("network blip"));
    enableBiometric.mockResolvedValue({ outcome: "enabled", kind: "faceId" });
    getStatus.mockResolvedValue(FACE_ID_ENABLED);
    await user.click(screen.getByText("enable biometrics"));

    await waitFor(() => expect(screen.getByTestId("enable-result").textContent).toBe("enabled"));
    expect(screen.getByTestId("biometric-enabled").textContent).toBe("true");
    consoleError.mockRestore();
  });
});
