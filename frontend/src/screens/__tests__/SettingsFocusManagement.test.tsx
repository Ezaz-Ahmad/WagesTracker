// @vitest-environment jsdom
//
// Component tests for SettingsLayout's mobile focus management (see its
// useEffect for the full rationale). On mobile, opening a category hides
// the nav list via CSS — which jsdom never actually applies, since it
// doesn't load real stylesheets — but the underlying JS state transition
// (`activeCategory` going from null to a category id, and back) is exactly
// what drives the focus-management effect, independent of whether the CSS
// visually hides anything in this test environment. So this still
// faithfully exercises the real bug: without the fix, opening a category on
// mobile leaves focus sitting on a button inside what *would* be a
// display:none panel in the real app.
//
// window.matchMedia is mocked directly (rather than relying on jsdom's own,
// which can't evaluate a real viewport width) so each test can force
// "mobile" or "desktop" deterministically, matching SettingsLayout's own
// `(min-width: 1080px)` check.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

function useFakeApp(): AppCtx {
  return {
    user: testUser,
    updateSettings: vi.fn().mockResolvedValue(undefined),
    changePassword: vi.fn().mockResolvedValue(undefined),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    sessions: [],
    sessionsLoading: false,
    sessionsError: null,
    loadSessions: vi.fn().mockResolvedValue(undefined),
    revokeSession: vi.fn().mockResolvedValue(undefined),
    revokeOtherSessions: vi.fn().mockResolvedValue(undefined),
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

function mockMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Settings focus management — mobile (single-column)", () => {
  it("moves focus to the detail heading when a category is opened", async () => {
    mockMatchMedia(false); // never matches the desktop (min-width: 1080px) query
    const user = userEvent.setup();
    render(<SettingsScreen />);

    await user.click(screen.getByRole("button", { name: /security/i }));

    await waitFor(() => {
      const heading = screen.getByRole("heading", { name: "Security", level: 2 });
      expect(document.activeElement).toBe(heading);
    });
    // Programmatic-only focus target — never reachable by Tab.
    expect(screen.getByRole("heading", { name: "Security", level: 2 }).getAttribute("tabindex")).toBe("-1");
  });

  it("restores focus to the category button that opened the detail, when going back", async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    render(<SettingsScreen />);

    const securityBtn = screen.getByRole("button", { name: /security/i });
    await user.click(securityBtn);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Security", level: 2 })));

    await user.click(screen.getByRole("button", { name: /back to settings/i }));

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /security/i })));
  });

  it("moves focus and restores it correctly across a different category too", async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    render(<SettingsScreen />);

    await user.click(screen.getByRole("button", { name: /data & account/i }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Data & account", level: 2 })));

    await user.click(screen.getByRole("button", { name: /back to settings/i }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: /data & account/i })));
  });
});

describe("Settings focus management — desktop (two-column)", () => {
  it("does not steal focus away from the clicked nav button when switching categories", async () => {
    mockMatchMedia(true); // always matches the desktop (min-width: 1080px) query
    const user = userEvent.setup();
    render(<SettingsScreen />);

    const workPayBtn = screen.getByRole("button", { name: /work & pay/i });
    await user.click(workPayBtn);

    // The browser's own click-focuses-the-button behavior is expected and
    // fine; what must NOT happen is SettingsLayout additionally yanking
    // focus over to the detail heading on desktop.
    expect(document.activeElement).toBe(workPayBtn);
    expect(document.activeElement).not.toBe(screen.getByRole("heading", { name: "Work & pay", level: 2 }));
  });
});
