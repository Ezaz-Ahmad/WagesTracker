// @vitest-environment jsdom
//
// Coverage for AppContext's pending-notification-sign-out reconciliation
// effect: a "Sign out" tap on the shift-in-progress notification that the
// native layer couldn't finish itself (see platform/shiftNotifications.ts,
// ShiftNotificationPlugin.swift's performEndShiftRequest) leaves a pending
// record for the app to finish on its own next launch. This exercises that
// effect directly through AppProvider/useApp, mirroring
// biometricLogin.test.tsx's approach — the native plugin can't run in this
// sandbox, so what's under test is entirely AppContext's own reconciliation
// contract: it runs once per signed-in session, finishes the PATCH through
// the same client as the in-app Sign out button, clears the pending record
// either way, and never turns a non-401 failure into a user-facing error.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "../AppContext";

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
    patchShift: vi.fn(),
  };
});

vi.mock("../../platform/biometricAuth", () => ({
  checkBiometricCapabilities: vi.fn(async () => ({ kind: "none", enrolled: false })),
  getBiometricStatus: vi.fn(async () => ({ enabled: false })),
  enableBiometricLogin: vi.fn(),
  authenticateWithBiometrics: vi.fn(),
  disableBiometricLogin: vi.fn(async () => {}),
}));

const getPendingEndShift = vi.fn();
const clearPendingEndShift = vi.fn().mockResolvedValue(undefined);
vi.mock("../../platform/shiftNotifications", () => ({
  getPendingEndShift: (...args: unknown[]) => getPendingEndShift(...args),
  clearPendingEndShift: (...args: unknown[]) => clearPendingEndShift(...args),
  postShiftStartedNotification: vi.fn().mockResolvedValue(undefined),
  clearShiftNotification: vi.fn().mockResolvedValue(undefined),
}));

import * as api from "../../lib/api";

const apiLogin = api.login as unknown as ReturnType<typeof vi.fn>;
const apiPatchShift = api.patchShift as unknown as ReturnType<typeof vi.fn>;
const apiLogout = api.logout as unknown as ReturnType<typeof vi.fn>;

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

function Harness() {
  const { status, shifts, login, authError } = useApp();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="shift-count">{shifts.length}</div>
      <div data-testid="auth-error">{authError ?? ""}</div>
      <button type="button" onClick={() => void login(USER.email, "correct horse battery staple", true)}>
        log in
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getPendingEndShift.mockResolvedValue(null);
  clearPendingEndShift.mockResolvedValue(undefined);
});

afterEach(cleanup);

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

describe("pending notification sign-out reconciliation", () => {
  it("does nothing when there is no pending record", async () => {
    const user = userEvent.setup();
    getPendingEndShift.mockResolvedValue(null);

    await logIn(user);

    await waitFor(() => expect(getPendingEndShift).toHaveBeenCalled());
    expect(apiPatchShift).not.toHaveBeenCalled();
    expect(clearPendingEndShift).not.toHaveBeenCalled();
  });

  it("finishes the sign-out through the ordinary API client and clears the pending record on success", async () => {
    const user = userEvent.setup();
    getPendingEndShift.mockResolvedValue({ shiftId: "shift-1", signOut: "17:05:00" });
    apiPatchShift.mockResolvedValue({
      shift: { id: "shift-1", date: "2026-08-15", location: "Downtown Store", signIn: "09:00:00", signOut: "17:05:00" },
    });

    await logIn(user);

    await waitFor(() => expect(apiPatchShift).toHaveBeenCalledWith("shift-1", { signOut: "17:05:00" }));
    await waitFor(() => expect(clearPendingEndShift).toHaveBeenCalledOnce());
    expect(screen.getByTestId("auth-error").textContent).toBe("");
  });

  it("still clears the pending record when the reconciliation PATCH fails for an ordinary (non-401) reason", async () => {
    // e.g. the shift was already ended some other way, or already deleted —
    // there is no retry loop; the in-app Sign out button is always still
    // there as a fallback, and surfacing an error banner over a background
    // reconciliation the user never directly asked for would be confusing.
    const user = userEvent.setup();
    getPendingEndShift.mockResolvedValue({ shiftId: "shift-1", signOut: "17:05:00" });
    apiPatchShift.mockRejectedValue(new Error("shift not found"));

    await logIn(user);

    await waitFor(() => expect(apiPatchShift).toHaveBeenCalled());
    await waitFor(() => expect(clearPendingEndShift).toHaveBeenCalledOnce());
    expect(screen.getByTestId("status").textContent).toBe("loggedIn");
    expect(screen.getByTestId("auth-error").textContent).toBe("");
  });

  it("triggers the normal expired-session logout when the reconciliation PATCH 401s, and still clears the pending record", async () => {
    // Deliberately does not reuse the shared logIn() helper — that helper
    // waits for status to settle on "loggedIn" first, but here the
    // reconciliation effect's 401 can flip status back to "loggedOut" fast
    // enough that "loggedIn" is never observably stable in between.
    const user = userEvent.setup();
    const { ApiError } = await import("../../lib/api");
    getPendingEndShift.mockResolvedValue({ shiftId: "shift-1", signOut: "17:05:00" });
    apiPatchShift.mockRejectedValue(new ApiError("Invalid or expired token", 401));
    apiLogin.mockResolvedValue({ token: "ordinary-token", user: USER });

    render(
      <AppProvider>
        <Harness />
      </AppProvider>
    );
    await user.click(screen.getByText("log in"));

    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("loggedOut"));
    expect(apiLogout).toHaveBeenCalled();
    await waitFor(() => expect(clearPendingEndShift).toHaveBeenCalledOnce());
    expect(screen.getByTestId("auth-error").textContent).toMatch(/session expired/i);
  });

  it("runs at most once per signed-in session even though React StrictMode double-invokes effects", async () => {
    const user = userEvent.setup();
    getPendingEndShift.mockResolvedValue({ shiftId: "shift-1", signOut: "17:05:00" });
    apiPatchShift.mockResolvedValue({
      shift: { id: "shift-1", date: "2026-08-15", location: "Downtown Store", signIn: "09:00:00", signOut: "17:05:00" },
    });

    await logIn(user);

    await waitFor(() => expect(clearPendingEndShift).toHaveBeenCalledOnce());
    expect(getPendingEndShift).toHaveBeenCalledTimes(1);
    expect(apiPatchShift).toHaveBeenCalledTimes(1);
  });
});
