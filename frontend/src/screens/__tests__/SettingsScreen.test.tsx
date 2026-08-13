// @vitest-environment jsdom
//
// A genuine component-level regression test for the password-change ->
// session-list-refresh bug: SettingsScreen.tsx's handleChangePassword must
// call loadSessions() after changePassword() resolves, so the Security &
// Sessions list reflects the sessions the backend actually revoked/created,
// without needing Settings to be closed and reopened.
//
// Unlike src/lib/__tests__/passwordChangeSessionRefresh.test.ts (which
// exercises api.ts's changePassword/setToken/listSessions directly, proving
// the *token* used by a refetch is correct), this file renders the real
// <SettingsScreen /> and drives it through actual user input, so it fails
// if `await loadSessions()` is ever removed from handleChangePassword —
// the api-level test alone would not catch that, since it never calls
// SettingsScreen's code at all.
//
// This is the one component test in the project so far, hence the
// `@vitest-environment jsdom` pragma above (see vitest.config.ts) instead of
// switching the whole suite over to jsdom.
import { useCallback, useSyncExternalStore } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../../lib/api";
import type { useApp } from "../../context/AppContext";
import type { User } from "../../lib/types";
import { SettingsScreen } from "../SettingsScreen";

type AppCtx = ReturnType<typeof useApp>;

const testUser: User = {
  id: "user-1",
  name: "Test User",
  email: "test-user@example.com",
  address: "",
  workLocationName: "",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Monday",
  rate: 20,
  goalHours: 35,
  goalEarnings: 700,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const oldSessions: SessionInfo[] = [
  { id: "old-1", userAgent: "Old Device A", ipAddress: "1.1.1.1", createdAt: "2026-01-01T00:00:00.000Z", lastActiveAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", isCurrent: true },
  { id: "old-2", userAgent: "Old Device B", ipAddress: "2.2.2.2", createdAt: "2026-01-01T00:00:00.000Z", lastActiveAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", isCurrent: false },
];

const newSessions: SessionInfo[] = [
  { id: "new-1", userAgent: "New Device", ipAddress: "3.3.3.3", createdAt: "2026-01-05T00:00:00.000Z", lastActiveAt: "2026-01-05T00:00:00.000Z", expiresAt: "2026-02-05T00:00:00.000Z", isCurrent: true },
];

// Configurable per test, read live by the fake context hook below —
// reassigned in beforeEach/each test rather than passed as props, since
// useApp() takes no arguments in the real app either.
let initialSessions: SessionInfo[];
let changePasswordImpl: (currentPassword: string, newPassword: string) => Promise<void>;
let fetchSessionsImpl: () => Promise<SessionInfo[]>;
let callOrder: string[];

// The Settings hub is now several independent components (ProfileSettings,
// WorkPaySettings, GoalSettings, SecuritySettings, SessionList,
// DataAccountSettings), each calling useApp() on its own — unlike the old
// single-component SettingsScreen, a plain `useState` inside this fake hook
// would give *each calling component its own separate copy* of the
// sessions state (React attributes hooks to whichever fiber is currently
// rendering them), so SecuritySettings changing the password and calling
// loadSessions would never be visible to SessionList's own copy. A tiny
// external store shared by every useFakeApp() call — subscribed to via
// useSyncExternalStore — is what actually makes this behave like one real
// shared context, the way AppProvider's single useState instance does in
// production.
interface SessionsState {
  sessions: SessionInfo[];
  sessionsLoading: boolean;
  sessionsError: string | null;
}
function createSessionsStore(initial: SessionInfo[]) {
  let state: SessionsState = { sessions: initial, sessionsLoading: false, sessionsError: null };
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    setState: (patch: Partial<SessionsState>) => {
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
let sessionsStore: ReturnType<typeof createSessionsStore>;

// A minimal stand-in for AppContext's real state/logic — just enough of it
// (sessions/sessionsLoading/sessionsError/loadSessions/changePassword) to
// drive the Settings hub exactly the way the real AppProvider would.
// Mirrors AppContext.loadSessions's own error handling (catches and sets
// sessionsError, never rethrows) so the failure test below behaves the same
// way the real app does.
function useFakeApp(): AppCtx {
  const { sessions, sessionsLoading, sessionsError } = useSyncExternalStore(sessionsStore.subscribe, sessionsStore.getState);

  const loadSessions = useCallback(async () => {
    callOrder.push("loadSessions:start");
    sessionsStore.setState({ sessionsLoading: true, sessionsError: null });
    try {
      const next = await fetchSessionsImpl();
      sessionsStore.setState({ sessions: next, sessionsLoading: false });
      callOrder.push("loadSessions:resolved");
    } catch (e) {
      sessionsStore.setState({ sessionsError: e instanceof Error ? e.message : "Couldn't load sessions", sessionsLoading: false });
      callOrder.push("loadSessions:failed");
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    callOrder.push("changePassword:start");
    await changePasswordImpl(currentPassword, newPassword);
    callOrder.push("changePassword:resolved");
  }, []);

  return {
    user: testUser,
    updateSettings: vi.fn().mockResolvedValue(undefined),
    changePassword,
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    sessions,
    sessionsLoading,
    sessionsError,
    loadSessions,
    revokeSession: vi.fn().mockResolvedValue(undefined),
    revokeOtherSessions: vi.fn().mockResolvedValue(undefined),
    // Everything below this line is unused by the Settings hub — inert stubs
    // only so this object satisfies AppContextValue's full shape.
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

// Settings is now a hub of categories (Profile & preferences, Work & pay,
// Weekly goals, Security, Data & account) rather than one long page — the
// password form and session list live under "Security," which isn't the
// default category shown on render. Every category panel is always mounted
// (see SettingsScreen.tsx), so navigating there doesn't lose anything; it's
// just required before these fields are visible/interactable.
async function goToSecurity() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /security/i }));
}

async function fillAndSubmitPasswordChangeForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Current password"), "current-password-123");
  await user.type(screen.getByLabelText("New password"), "brand-new-secure-login-2026!");
  await user.type(screen.getByLabelText("Confirm new password"), "brand-new-secure-login-2026!");
  await user.click(screen.getByRole("button", { name: /change password/i }));
}

describe("SettingsScreen — session list refresh after password change", () => {
  beforeEach(() => {
    initialSessions = oldSessions;
    sessionsStore = createSessionsStore(initialSessions);
    callOrder = [];
    changePasswordImpl = vi.fn().mockResolvedValue(undefined);
    fetchSessionsImpl = vi.fn().mockResolvedValue(oldSessions);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows only the new replacement session as 'This device', and calls loadSessions only after changePassword resolves", async () => {
    fetchSessionsImpl = vi.fn().mockResolvedValueOnce(oldSessions).mockResolvedValue(newSessions);

    render(<SettingsScreen />);
    await goToSecurity();

    // Old sessions are what's shown before anything happens. getByText
    // throws (failing the test) if the text isn't found, so its return
    // value is asserted truthy mainly for readability at the call site.
    expect(screen.getByText("Old Device A")).toBeTruthy();
    expect(screen.getByText("Old Device B")).toBeTruthy();
    const oldCurrentCard = screen.getByText("Old Device A").closest("li")!;
    expect(within(oldCurrentCard).getByText("This device")).toBeTruthy();

    await fillAndSubmitPasswordChangeForm();

    // The old, revoked sessions disappear, and the new one is shown as
    // "This device" — without this test having to reload/remount anything.
    await waitFor(() => expect(screen.queryByText("Old Device A")).toBeNull());
    expect(screen.queryByText("Old Device B")).toBeNull();
    expect(screen.getByText("New Device")).toBeTruthy();
    const newCurrentCard = screen.getByText("New Device").closest("li")!;
    expect(within(newCurrentCard).getByText("This device")).toBeTruthy();

    // loadSessions must never run until changePassword has actually
    // resolved — this is what would fail if `await loadSessions()` were
    // removed (or reordered before the change-password call) in
    // SettingsScreen.tsx.
    const changePasswordResolvedIndex = callOrder.indexOf("changePassword:resolved");
    const loadSessionsAfterChangeIndex = callOrder.indexOf("loadSessions:start", changePasswordResolvedIndex);
    expect(changePasswordResolvedIndex).toBeGreaterThanOrEqual(0);
    expect(loadSessionsAfterChangeIndex).toBeGreaterThan(changePasswordResolvedIndex);
  });

  it("keeps the password-change success state and shows the session error, without restoring the old list, if the post-change refresh fails", async () => {
    let sessionsFetchCount = 0;
    fetchSessionsImpl = vi.fn().mockImplementation(async () => {
      sessionsFetchCount += 1;
      if (sessionsFetchCount === 1) return oldSessions; // the initial load when Settings opened
      throw new Error("Couldn't load sessions"); // the reload after the password change
    });

    render(<SettingsScreen />);
    await goToSecurity();
    await waitFor(() => expect(screen.getByText("Old Device A")).toBeTruthy());

    await fillAndSubmitPasswordChangeForm();

    // Password change itself is reported as successful...
    await waitFor(() => expect(screen.getByText("Password changed")).toBeTruthy());
    expect(screen.queryByText("Couldn't change password")).toBeNull();

    // ...even though the session-list refresh that followed it failed — that
    // failure shows up only in the sessions section, as its own error.
    expect(screen.getByText("Couldn't load sessions")).toBeTruthy();
    // The stale old-session cards aren't left on screen once the error view
    // takes over — no risk of them being mistaken for the still-valid state.
    expect(screen.queryByText("Old Device A")).toBeNull();
  });
});
