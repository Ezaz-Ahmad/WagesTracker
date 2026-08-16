// @vitest-environment jsdom
//
// Automated accessibility check for the major Settings states, using
// axe-core (via jest-axe) rather than relying only on manual review or
// snapshots. color-contrast is disabled because jsdom doesn't load
// stylesheets or perform real layout/paint, so axe has no actual rendered
// color to evaluate here — contrast is instead verified by the ratios
// computed for the CSS tokens themselves (see tokens.css's comments).
import { useCallback, useState } from "react";
import { cleanup, render, waitFor, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../../lib/api";
import type { useApp } from "../../context/AppContext";
import type { User } from "../../lib/types";
import { SettingsScreen } from "../../screens/SettingsScreen";

expect.extend(toHaveNoViolations);

type AppCtx = ReturnType<typeof useApp>;

const testUser: User = {
  id: "user-1",
  name: "Test User",
  email: "test-user@example.com",
  address: "123 Main St",
  workLocationName: "Downtown Store",
  workAddress: "1 Market Sq",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Monday",
  rate: 20,
  goalHours: 35,
  goalEarnings: 700,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const sessions: SessionInfo[] = [
  { id: "current-1", userAgent: "Chrome on macOS", ipAddress: "1.2.3.4", createdAt: "2026-01-01T00:00:00.000Z", lastActiveAt: "2026-01-05T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", isCurrent: true, biometricProtected: false },
  { id: "other-1", userAgent: "Firefox on Windows", ipAddress: "5.6.7.8", createdAt: "2026-01-01T00:00:00.000Z", lastActiveAt: "2026-01-02T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", isCurrent: false, biometricProtected: false },
];

function useFakeApp(): AppCtx {
  const [sessionState, setSessionState] = useState<SessionInfo[]>([]);
  const loadSessions = useCallback(async () => {
    setSessionState(sessions);
  }, []);

  return {
    user: testUser,
    updateSettings: vi.fn().mockResolvedValue(undefined),
    changePassword: vi.fn().mockResolvedValue(undefined),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    sessions: sessionState,
    sessionsLoading: false,
    sessionsError: null,
    loadSessions,
    revokeSession: vi.fn().mockResolvedValue(undefined),
    revokeOtherSessions: vi.fn().mockResolvedValue(undefined),
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

const axeOptions = { rules: { "color-contrast": { enabled: false } } };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Settings accessibility (axe)", () => {
  it("has no detectable violations on the default Profile & preferences view", async () => {
    const { container } = render(<SettingsScreen />);
    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it("has no detectable violations on the Security view with sessions loaded", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsScreen />);
    await user.click(screen.getByRole("button", { name: /security/i }));
    await waitFor(() => expect(screen.getByText("Chrome on macOS")).toBeTruthy());

    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });

  it("has no detectable violations on the Data & account view", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsScreen />);
    await user.click(screen.getByRole("button", { name: /data & account/i }));

    expect(await axe(container, axeOptions)).toHaveNoViolations();
  });
});
