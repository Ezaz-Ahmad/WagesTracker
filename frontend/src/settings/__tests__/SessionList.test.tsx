// @vitest-environment jsdom
//
// Component tests for the redesigned Security & Sessions list: loading,
// empty, and error states; the current device always sorting first
// regardless of backend order; the explicit Refresh action; and individual
// / all-other-devices logout.
import { useCallback, useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../../lib/api";
import type { useApp } from "../../context/AppContext";
import { SessionList } from "../SessionList";

type AppCtx = ReturnType<typeof useApp>;

// Deliberately NOT current-first, to prove the component (not the fixture)
// does the sorting.
const twoSessions: SessionInfo[] = [
  { id: "other-1", userAgent: "Firefox on Windows", ipAddress: "5.6.7.8", createdAt: "2026-01-01T00:00:00.000Z", lastActiveAt: "2026-01-02T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", isCurrent: false },
  { id: "current-1", userAgent: "Chrome on macOS", ipAddress: "1.2.3.4", createdAt: "2026-01-01T00:00:00.000Z", lastActiveAt: "2026-01-05T00:00:00.000Z", expiresAt: "2026-02-01T00:00:00.000Z", isCurrent: true },
];

let fetchSessionsImpl: () => Promise<SessionInfo[]>;
let revokeSessionImpl: (id: string) => Promise<void>;
let revokeOtherSessionsImpl: () => Promise<void>;

function useFakeApp(): AppCtx {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      setSessions(await fetchSessionsImpl());
    } catch (e) {
      setSessionsError(e instanceof Error ? e.message : "Couldn't load sessions");
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const revokeSession = useCallback(async (id: string) => {
    await revokeSessionImpl(id);
  }, []);
  const revokeOtherSessions = useCallback(async () => {
    await revokeOtherSessionsImpl();
  }, []);

  return { sessions, sessionsLoading, sessionsError, loadSessions, revokeSession, revokeOtherSessions } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

beforeEach(() => {
  fetchSessionsImpl = vi.fn().mockResolvedValue(twoSessions);
  revokeSessionImpl = vi.fn().mockResolvedValue(undefined);
  revokeOtherSessionsImpl = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SessionList", () => {
  it("shows a loading state, then the current device first with its badge, regardless of backend order", async () => {
    render(<SessionList />);
    // The first-load placeholder is now a skeleton sized like the real
    // cards (so the panel doesn't jump when they arrive) rather than a line
    // of text; the accessible name is what carries the state.
    expect(screen.getByRole("status", { name: "Loading your active sessions" })).toBeTruthy();

    await waitFor(() => expect(screen.getByText("Chrome on macOS")).toBeTruthy());
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText("Chrome on macOS")).toBeTruthy();
    expect(within(cards[0]).getByText("This device")).toBeTruthy();
    expect(within(cards[1]).getByText("Firefox on Windows")).toBeTruthy();
  });

  it("shows an empty state when there are no sessions", async () => {
    fetchSessionsImpl = vi.fn().mockResolvedValue([]);
    render(<SessionList />);
    await waitFor(() => expect(screen.getByText("No devices to show")).toBeTruthy());
  });

  it("shows an error state when loading fails", async () => {
    fetchSessionsImpl = vi.fn().mockRejectedValue(new Error("Couldn't load sessions"));
    render(<SessionList />);
    await waitFor(() => expect(screen.getByText("Couldn't load sessions")).toBeTruthy());
  });

  it("reloads the list via the Refresh action", async () => {
    render(<SessionList />);
    await waitFor(() => expect(screen.getByText("Chrome on macOS")).toBeTruthy());
    expect(fetchSessionsImpl).toHaveBeenCalledTimes(1);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(fetchSessionsImpl).toHaveBeenCalledTimes(2));
  });

  it("logs out an individual non-current device", async () => {
    render(<SessionList />);
    await waitFor(() => expect(screen.getByText("Firefox on Windows")).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /log out firefox on windows/i }));

    await waitFor(() => expect(revokeSessionImpl).toHaveBeenCalledWith("other-1"));
    await waitFor(() => expect(screen.getByText(/has been logged out/)).toBeTruthy());
  });

  it("logs out all other devices via the block action, and confirms it", async () => {
    render(<SessionList />);
    await waitFor(() => expect(screen.getByText("Firefox on Windows")).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /log out all other devices/i }));
    await waitFor(() => expect(revokeOtherSessionsImpl).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("All other devices have been logged out.")).toBeTruthy());
  });

  it("hides the \"log out all other devices\" action when only the current device is left", async () => {
    fetchSessionsImpl = vi.fn().mockResolvedValue([twoSessions[1]]);
    render(<SessionList />);
    await waitFor(() => expect(screen.getByText("Chrome on macOS")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /log out all other devices/i })).toBeNull();
  });
});
