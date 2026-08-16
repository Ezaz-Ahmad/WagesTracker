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
    biometricProtected: false,
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
    expect(await screen.findByRole("status", { name: "Loading your active sessions" })).toBeTruthy();
    release(MANY);
    await waitFor(() => expect(cards().length).toBe(SUMMARY_SESSION_LIMIT));
  });

  // With zero sessions there is no "View all sessions" button to open the
  // drawer with, so what's actually on screen here is the panel's own empty
  // state. It now says what the situation means and offers a way out,
  // instead of stating a dead end ("No active sessions found.") that can't
  // be true while you're reading it — you are a session.
  it("renders the empty state when there are no sessions", async () => {
    fetchSessionsImpl = async () => [];
    renderList();
    expect(await screen.findByText("No devices to show")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /View all sessions/ })).toBeNull();
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

// ── Additions from the final UI/UX pass ──────────────────────────────────
//
// Each of these covers a behaviour that was previously either unspecified
// or actively wrong, not just a re-assertion of something already proven
// above.

describe("summary ordering", () => {
  it("picks the two most recently active others, not whatever order the server sent", async () => {
    // Deliberately shuffled, and with the freshest sessions buried in the
    // middle: the component has to sort, not trust the fixture. Previously
    // this ordering was delegated to the backend's ORDER BY with only a
    // comment saying so, so a change there would have silently degraded the
    // summary into "three arbitrary devices" with nothing failing.
    const stale = makeSession(1, { id: "stale", lastActiveAt: "2026-01-02T00:00:00.000Z" });
    const freshest = makeSession(2, { id: "freshest", lastActiveAt: "2026-02-20T00:00:00.000Z" });
    const middling = makeSession(3, { id: "middling", lastActiveAt: "2026-02-10T00:00:00.000Z" });
    const current = makeSession(4, { id: "current", isCurrent: true, lastActiveAt: "2026-01-01T00:00:00.000Z" });
    fetchSessionsImpl = async () => [stale, current, freshest, middling];

    renderList();
    await waitFor(() => expect(cards().length).toBe(SUMMARY_SESSION_LIMIT));

    // Current device first even though it is the *least* recently active.
    expect(within(cards()[0]).getByText("This device")).toBeTruthy();
    expect(within(cards()[1]).getByText("Chrome on Windows 2")).toBeTruthy();
    expect(within(cards()[2]).getByText("Chrome on Windows 3")).toBeTruthy();
    // The stale one is pushed out of the summary entirely.
    expect(screen.queryByText("Chrome on Windows 1")).toBeNull();
  });

  it("sorts a session with an unparseable last-active timestamp last instead of scrambling the list", async () => {
    const broken = makeSession(1, { id: "broken", lastActiveAt: "not-a-date" });
    const good = makeSession(2, { id: "good", lastActiveAt: "2026-02-20T00:00:00.000Z" });
    const current = makeSession(3, { id: "current", isCurrent: true });
    fetchSessionsImpl = async () => [broken, good, current];

    renderList();
    await waitFor(() => expect(cards().length).toBe(3));
    expect(within(cards()[0]).getByText("This device")).toBeTruthy();
    expect(within(cards()[1]).getByText("Chrome on Windows 2")).toBeTruthy();
    expect(within(cards()[2]).getByText("Chrome on Windows 1")).toBeTruthy();
  });
});

describe("session card content", () => {
  it("gives each device a kind glyph and demotes the IP below the sign-in time", async () => {
    fetchSessionsImpl = async () => [
      makeSession(1, {
        id: "current",
        isCurrent: true,
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
        ipAddress: "203.0.113.9",
      }),
    ];
    renderList();
    await waitFor(() => expect(cards().length).toBe(1));
    const card = cards()[0];

    // The glyph restates the adjacent label, so it must not be announced.
    const glyph = card.querySelector(".session-card-icon");
    expect(glyph).not.toBeNull();
    expect(glyph!.getAttribute("aria-hidden")).toBe("true");

    // Last active is the primary line; the IP is on its own tertiary line
    // rather than sharing the sign-in line at the same weight.
    expect(within(card).getByText(/^Last active /)).toBeTruthy();
    expect(within(card).getByText(/^First signed in /)).toBeTruthy();
    const ip = within(card).getByText("IP 203.0.113.9");
    expect(ip.className).toContain("session-card-tertiary");
  });

  // SessionInfo types ipAddress as a plain string, so "no address" reaches
  // the client as "" rather than null — the card has to treat that as absent
  // instead of rendering a bare "IP" label with nothing after it.
  it("omits the IP line entirely rather than printing a bare label when there is no address", async () => {
    fetchSessionsImpl = async () => [makeSession(1, { id: "current", isCurrent: true, ipAddress: "" })];
    renderList();
    await waitFor(() => expect(cards().length).toBe(1));
    expect(cards()[0].querySelector(".session-card-tertiary")).toBeNull();
  });
});

describe("revoking from inside the drawer", () => {
  it("shows the failure inside the dialog, not on the panel hidden behind it", async () => {
    // The bug: the revoke handler lives on SessionList, so its error banner
    // rendered *behind* the drawer's own backdrop. From the user's side the
    // card simply reappeared with no explanation at all.
    revokeSessionImpl = async () => {
      throw new Error("Network unavailable");
    };
    const user = userEvent.setup();
    renderList();
    const dialog = await openDrawer(user);

    const target = within(dialog).getAllByTestId("session-card")[1];
    await user.click(within(target).getByRole("button", { name: /^Log out / }));
    await confirmDialog(user);

    const message = await within(dialog).findByText("Network unavailable");
    expect(message).toBeTruthy();
    // Exactly once in the whole document: the panel behind suppresses its
    // copy while the dialog is open, so a screen reader isn't handed the
    // same text in two live regions.
    expect(screen.getAllByText("Network unavailable")).toHaveLength(1);
  });

  it("drops the card and updates the remaining count immediately on success", async () => {
    const user = userEvent.setup();
    renderList();
    const dialog = await openDrawer(user);
    const before = within(dialog).getAllByTestId("session-card").length;

    const target = within(dialog).getAllByTestId("session-card")[1];
    await user.click(within(target).getByRole("button", { name: /^Log out / }));
    await confirmDialog(user);

    await waitFor(() => expect(within(dialog).getAllByTestId("session-card").length).toBe(before - 1));
    // The dialog's own count sentence tracks it too, rather than going stale
    // until the next open.
    expect(within(dialog).getByText(`${before - 1} devices are signed in to your account.`)).toBeTruthy();
  });
});

describe("refreshing", () => {
  it("keeps the list on screen and says it is refreshing, rather than emptying it", async () => {
    const user = userEvent.setup();
    renderList();
    await waitFor(() => expect(cards().length).toBe(SUMMARY_SESSION_LIMIT));

    let release: (value: SessionInfo[]) => void = () => {};
    fetchSessionsImpl = () => new Promise<SessionInfo[]>((resolve) => (release = resolve));
    await user.click(screen.getByRole("button", { name: /refresh/i }));

    // Cards stay put while the request is in flight — no teardown, no
    // reflow of everything below.
    expect(cards().length).toBe(SUMMARY_SESSION_LIMIT);
    const refresh = screen.getByRole("button", { name: /refreshing/i });
    expect(refresh.getAttribute("aria-busy")).toBe("true");

    release(MANY);
    await waitFor(() => expect(screen.getByRole("button", { name: /^refresh$/i })).toBeTruthy());
  });
});
