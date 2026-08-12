// @vitest-environment jsdom
//
// The sessions summary + "All active sessions" dialog.
//
// The behaviour under test is what happens when an account has *many*
// devices, which is exactly the case the old unbounded list handled badly:
// the Settings panel must stay a fixed three cards, and everything else has
// to be reachable through a dialog that behaves like one — focus trapped
// inside it, focus returned to the control that opened it, Escape closing
// it, and the destructive action reachable without scrolling past twelve
// devices.
import { useCallback, useState } from "react";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../../lib/api";
import type { useApp } from "../../context/AppContext";
import { ConfirmProvider } from "../../components/ConfirmProvider";
import { SessionList, SUMMARY_SESSION_LIMIT } from "../SessionList";

type AppCtx = ReturnType<typeof useApp>;

function makeSession(n: number, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: `session-${n}`,
    userAgent: `Chrome on Windows ${n}`,
    ipAddress: `10.0.0.${n}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    // Descending, so "newest active first" is observable.
    lastActiveAt: new Date(Date.UTC(2026, 0, 30 - n)).toISOString(),
    expiresAt: "2026-03-01T00:00:00.000Z",
    isCurrent: false,
    ...overrides,
  };
}

/** Twelve devices, with the current one deliberately NOT first, so the
 * component (not the fixture) has to do the pinning. */
const MANY: SessionInfo[] = [
  ...Array.from({ length: 11 }, (_, i) => makeSession(i + 1)),
  makeSession(99, { id: "current", userAgent: "Safari on iOS", isCurrent: true }),
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
    setSessions((current) => current.filter((s) => s.id !== id));
  }, []);

  const revokeOtherSessions = useCallback(async () => {
    await revokeOtherSessionsImpl();
    setSessions((current) => current.filter((s) => s.isCurrent));
  }, []);

  return {
    sessions,
    sessionsLoading,
    sessionsError,
    loadSessions,
    revokeSession,
    revokeOtherSessions,
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

function renderList() {
  return render(
    <ConfirmProvider>
      <SessionList />
    </ConfirmProvider>
  );
}

/** The app confirms destructive actions through ConfirmProvider's popup
 * (`data-confirm`), so a revoke isn't complete until that's accepted.
 * Scoped to the alertdialog itself — the page behind it is full of buttons
 * whose labels also start with "Log out". */
async function confirmDialog(user: ReturnType<typeof userEvent.setup>) {
  const popup = await screen.findByRole("alertdialog");
  await user.click(within(popup).getByRole("button", { name: /^(log out|yes|confirm)/i }));
}

function cards() {
  return screen.queryAllByTestId("session-card");
}

async function openDrawer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: /view all sessions/i }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  fetchSessionsImpl = async () => MANY;
  revokeSessionImpl = async () => {};
  revokeOtherSessionsImpl = async () => {};
});

afterEach(cleanup);

describe("sessions summary", () => {
  it("shows the current device first", async () => {
    renderList();
    await waitFor(() => expect(cards().length).toBeGreaterThan(0));
    expect(within(cards()[0]).getByText("This device")).toBeTruthy();
    expect(within(cards()[0]).getByText(/Safari on iOS/)).toBeTruthy();
  });

  it("shows only three cards no matter how many sessions there are", async () => {
    renderList();
    await waitFor(() => expect(cards().length).toBeGreaterThan(0));
    expect(cards()).toHaveLength(SUMMARY_SESSION_LIMIT);
    expect(SUMMARY_SESSION_LIMIT).toBe(3);
  });

  it("names the total on the view-all control", async () => {
    renderList();
    expect(await screen.findByRole("button", { name: `View all sessions (${MANY.length})` })).toBeTruthy();
  });

  it("hides the view-all control when everything already fits", async () => {
    fetchSessionsImpl = async () => MANY.slice(-2);
    renderList();
    await waitFor(() => expect(cards().length).toBe(2));
    expect(screen.queryByRole("button", { name: /view all sessions/i })).toBeNull();
  });
});

describe("the drawer", () => {
  it("opens on the view-all control and lists every active session", async () => {
    const user = userEvent.setup();
    renderList();
    const dialog = await openDrawer(user);

    expect(within(dialog).getByText("All active sessions")).toBeTruthy();
    expect(within(dialog).getByText(/12 devices are signed in/)).toBeTruthy();
    expect(within(dialog).getAllByTestId("session-card")).toHaveLength(MANY.length);
  });

  it("pins the current device to the top inside the drawer too", async () => {
    const user = userEvent.setup();
    renderList();
    const dialog = await openDrawer(user);
    const drawerCards = within(dialog).getAllByTestId("session-card");
    expect(within(drawerCards[0]).getByText("This device")).toBeTruthy();
  });

  it("is a modal dialog that traps focus", async () => {
    const user = userEvent.setup();
    renderList();
    const dialog = await openDrawer(user);

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    // Tab all the way around; focus must never escape to the page behind.
    for (let i = 0; i < 25; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("closes on Escape and returns focus to the view-all control", async () => {
    const user = userEvent.setup();
    renderList();
    await openDrawer(user);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect((document.activeElement as HTMLElement)?.textContent).toMatch(/view all sessions/i)
    );
  });

  it("closes on the close button", async () => {
    const user = userEvent.setup();
    renderList();
    const dialog = await openDrawer(user);
    await user.click(within(dialog).getByRole("button", { name: /close all active sessions/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("gives every icon-only control an accessible name", async () => {
    const user = userEvent.setup();
    renderList();
    const dialog = await openDrawer(user);
    for (const button of within(dialog).getAllByRole("button")) {
      const name = button.getAttribute("aria-label") ?? button.textContent ?? "";
      expect(name.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("revoking", () => {
  it("removes the device and updates the count", async () => {
    const user = userEvent.setup();
    renderList();
    const dialog = await openDrawer(user);

    const target = within(dialog).getAllByTestId("session-card")[1];
    await user.click(within(target).getByRole("button", { name: /^Log out / }));
    await confirmDialog(user);

    await waitFor(() => {
      const open = screen.getByRole("dialog");
      expect(within(open).getAllByTestId("session-card")).toHaveLength(MANY.length - 1);
      expect(within(open).getByText(/11 devices are signed in/)).toBeTruthy();
    });
  });

  it("puts the device back and explains when the revoke fails", async () => {
    const user = userEvent.setup();
    revokeSessionImpl = async () => {
      throw new Error("Network unavailable");
    };
    renderList();
    const dialog = await openDrawer(user);

    const target = within(dialog).getAllByTestId("session-card")[1];
    await user.click(within(target).getByRole("button", { name: /^Log out / }));
    await confirmDialog(user);

    // Optimism is not a licence to lose the user's data: the card returns.
    await waitFor(() => expect(screen.getByText("Network unavailable")).toBeTruthy());
    expect(within(screen.getByRole("dialog")).getAllByTestId("session-card")).toHaveLength(MANY.length);
  });

  it("leaves only the current device after logging out all others", async () => {
    const user = userEvent.setup();
    renderList();
    const dialog = await openDrawer(user);

    await user.click(within(dialog).getByRole("button", { name: /log out 11 other devices/i }));
    await confirmDialog(user);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(within(cards()[0]).getByText("This device")).toBeTruthy();
  });
});

describe("states", () => {
  it("renders a loading state before anything arrives", async () => {
    let release: (value: SessionInfo[]) => void = () => {};
    fetchSessionsImpl = () => new Promise<SessionInfo[]>((resolve) => (release = resolve));
    renderList();
    expect(await screen.findByText("Loading sessions…")).toBeTruthy();
    release(MANY);
    await waitFor(() => expect(cards().length).toBe(SUMMARY_SESSION_LIMIT));
  });

  it("renders the empty state when there are no sessions", async () => {
    fetchSessionsImpl = async () => [];
    renderList();
    expect(await screen.findByText("No active sessions found.")).toBeTruthy();
  });

  it("renders an error with a working retry", async () => {
    let attempts = 0;
    fetchSessionsImpl = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("Couldn't reach the server");
      return MANY;
    };
    const user = userEvent.setup();
    renderList();

    expect(await screen.findByText("Couldn't reach the server")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(cards().length).toBe(SUMMARY_SESSION_LIMIT));
  });
});
