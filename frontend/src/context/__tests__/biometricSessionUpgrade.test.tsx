// @vitest-environment jsdom
//
// Regression coverage for the "make Face ID sessions last 5 years instead
// of the ordinary 30 days" upgrade: a JWT's own expiry is baked in at
// signing time, so extending it can't be done by flipping a database column
// after the fact — enableBiometricLoginAction now asks the backend for a
// replacement, longer-lived token *before* prompting Face ID/Touch ID, so
// the credential the native prompt ends up storing is already the
// long-lived one, and rolls that upgrade back if the prompt then fails or
// is cancelled (so a declined enable never silently leaves a session
// idle-exempt and 5-years-lived with no biometric gate actually protecting
// it). See backend/test/session-biometric-protection.test.ts for the
// server-side half of this (the rotation itself, and the 5-year duration).
//
// biometricIdleExemption.test.tsx covers the idle-timer half of biometric
// login; this file is specifically about the token-upgrade choreography.
import { useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "../AppContext";
import type { BiometricEnableResult, BiometricStatus } from "../../platform/biometricAuth";

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
    setSessionBiometricProtection: vi.fn(),
  };
});

vi.mock("../../platform/biometricAuth", () => ({
  checkBiometricCapabilities: vi.fn(async () => ({ kind: "faceId", enrolled: true })),
  getBiometricStatus: vi.fn(async () => ({ enabled: false })),
  enableBiometricLogin: vi.fn(),
  authenticateWithBiometrics: vi.fn(),
  disableBiometricLogin: vi.fn(async () => {}),
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
  weekStartsOn: "Monday",
  rate: 20,
  goalHours: 40,
  goalEarnings: 800,
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

const FACE_ID_ENABLED: BiometricStatus = { enabled: true, accountId: "u1", accountLabel: "Sam Lee", kind: "faceId" };

function Harness() {
  const { biometricStatus, login, enableBiometricLogin } = useApp();
  const [lastEnableResult, setLastEnableResult] = useState<string>("");
  return (
    <div>
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
    </div>
  );
}

// Tracked outside the mock implementation (rather than by invoking the mock
// function itself, which some TS project-reference configs in this repo
// refuse to typecheck for a bare `ReturnType<typeof vi.fn>`) so assertions
// below can read "whatever the live app currently thinks its token is"
// directly.
let currentToken: string | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  getStatus.mockResolvedValue({ enabled: false });
  disableBiometric.mockResolvedValue(undefined);
  currentToken = null;
  apiSetToken.mockImplementation(async (token: string) => {
    currentToken = token;
  });
  apiGetToken.mockImplementation(() => currentToken);
});

afterEach(cleanup);

async function logIn(user: ReturnType<typeof userEvent.setup>) {
  apiLogin.mockResolvedValue({ token: "ordinary-30-day-token", user: USER });
  render(
    <AppProvider>
      <Harness />
    </AppProvider>
  );
  await user.click(screen.getByText("log in"));
  await waitFor(() => expect(currentToken).toBe("ordinary-30-day-token"));
}

describe("enabling biometric login upgrades the session's token before prompting", () => {
  it("stores the rotated 5-year token in the native credential, not the original 30-day one", async () => {
    const user = userEvent.setup();
    await logIn(user);

    apiSetSessionBiometricProtection.mockResolvedValue({ token: "five-year-token" });
    enableBiometric.mockResolvedValue({ outcome: "enabled", kind: "faceId" });
    getStatus.mockResolvedValue(FACE_ID_ENABLED);

    await user.click(screen.getByText("enable biometrics"));
    await waitFor(() => expect(screen.getByTestId("enable-result").textContent).toBe("enabled"));

    // The token handed to the native adapter's enable() — the one it will
    // store behind the biometric-gated Keychain item — must be the rotated
    // long-lived token, not the ordinary one the session started with.
    expect(enableBiometric).toHaveBeenCalledWith("u1", "Sam Lee", "sam@example.com", "five-year-token");
    // The live app's own token must end up the same, or the next request
    // from this device would use a token whose session was just revoked.
    expect(currentToken).toBe("five-year-token");
  });

  it("still enables biometrics with the ordinary token if the upgrade call fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    await logIn(user);

    apiSetSessionBiometricProtection.mockRejectedValueOnce(new Error("network blip"));
    enableBiometric.mockResolvedValue({ outcome: "enabled", kind: "faceId" });
    getStatus.mockResolvedValue(FACE_ID_ENABLED);

    await user.click(screen.getByText("enable biometrics"));
    await waitFor(() => expect(screen.getByTestId("enable-result").textContent).toBe("enabled"));

    // A failed upgrade must never block Face ID itself — it falls back to
    // whatever token was already on hand.
    expect(enableBiometric).toHaveBeenCalledWith("u1", "Sam Lee", "sam@example.com", "ordinary-30-day-token");
    expect(screen.getByTestId("biometric-enabled").textContent).toBe("true");
    // Only the one (failed) upgrade attempt — no rollback call, since
    // nothing was rotated in the first place.
    expect(apiSetSessionBiometricProtection).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("rolls the session back onto the ordinary lifetime if Face ID is cancelled after the upgrade already succeeded", async () => {
    const user = userEvent.setup();
    await logIn(user);

    apiSetSessionBiometricProtection.mockResolvedValueOnce({ token: "five-year-token" });
    apiSetSessionBiometricProtection.mockResolvedValueOnce({ token: "ordinary-again-token" });
    enableBiometric.mockResolvedValue({ outcome: "failed", reason: "user_cancelled" });

    await user.click(screen.getByText("enable biometrics"));
    await waitFor(() => expect(screen.getByTestId("enable-result").textContent).toBe("failed"));

    // Upgraded to the 5-year session, then rolled back once the prompt
    // itself was cancelled — never left stuck on the long-lived session
    // with no working biometric credential behind it.
    expect(apiSetSessionBiometricProtection).toHaveBeenNthCalledWith(1, true);
    expect(apiSetSessionBiometricProtection).toHaveBeenNthCalledWith(2, false);
    expect(disableBiometric).toHaveBeenCalled();
    expect(screen.getByTestId("biometric-enabled").textContent).toBe("false");
    // The live app is left on the rolled-back token, not the abandoned
    // 5-year one.
    expect(currentToken).toBe("ordinary-again-token");
  });
});
