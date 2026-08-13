// @vitest-environment jsdom
//
// Automated accessibility checks for the screens that had none.
//
// a11y coverage previously stopped at Settings (settings/__tests__/a11y.test.tsx),
// which is how a set of related defects survived across every other screen at
// once: charts with no accessible name or textual equivalent, a progress bar
// with no role, a table with no column scope, an auth card whose headings ran
// h1 -> h6 -> h3, and two screens with no landmark at all.
//
// color-contrast is off for the same reason it is in the Settings suite —
// jsdom does no layout or paint, so axe has no rendered colour to measure.
// Contrast is checked directly against the token values instead, in
// styles/__tests__/contrast.test.ts.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import type { Shift, User } from "../../lib/types";

expect.extend(toHaveNoViolations);

type AppCtx = ReturnType<typeof useApp>;

const USER: User = {
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
  createdAt: "2025-01-01T00:00:00.000Z",
};

const TODAY = new Date("2026-02-04T10:00:00.000Z");

/** A couple of real shifts across two weeks, so the charts, the history
 * table and the weekly comparison all have something to render — an empty
 * dataset would let every one of them bail out to an empty state and quietly
 * test nothing. */
// signIn/signOut are "HH:MM" wall-clock strings, not ISO timestamps — see
// lib/types.ts. Getting this wrong produces NaN hours everywhere downstream,
// which is exactly how the aria-valuenow="NaN" case below was found.
const SHIFTS: Shift[] = [
  { id: "s1", date: "2026-02-02", signIn: "09:00", signOut: "17:00", location: "Downtown Store" },
  { id: "s2", date: "2026-02-03", signIn: "09:00", signOut: "15:30", location: "Downtown Store" },
  { id: "s3", date: "2026-01-27", signIn: "09:00", signOut: "17:00", location: "Downtown Store" },
];

let earningsHidden = false;

function useFakeApp(): AppCtx {
  return {
    status: "loggedIn",
    user: USER,
    today: TODAY,
    shifts: SHIFTS,
    shiftsLoading: false,
    shiftsLoaded: true,
    dayExpenses: [{ date: "2026-02-02", fuelCost: 12 }],
    weekExtras: [],
    earningsHidden,
    authError: null,
    authBusy: false,
    actionError: null,
    sessionNotice: null,
    sessions: [],
    sessionsLoading: false,
    sessionsError: null,
    clearActionError: vi.fn(),
    dismissSessionNotice: vi.fn(),
    clearAuthError: vi.fn(),
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(),
    loadSessions: vi.fn(async () => {}),
    revokeSession: vi.fn(async () => {}),
    revokeOtherSessions: vi.fn(async () => {}),
    updateSettings: vi.fn(async () => {}),
    changePassword: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    createShift: vi.fn(async () => undefined),
    updateShift: vi.fn(async () => undefined),
    removeShift: vi.fn(async () => {}),
    setFuelCost: vi.fn(async () => {}),
    setWeekExtra: vi.fn(async () => true),
    refresh: vi.fn(async () => {}),
    revealEarnings: vi.fn(),
    hideEarningsNow: vi.fn(),
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

// Imported after the mock so the screens pick up the fake context.
const { HomeScreen } = await import("../HomeScreen");
const { ReportScreen } = await import("../ReportScreen");
const { HistoryScreen } = await import("../HistoryScreen");
const { EntryScreen } = await import("../EntryScreen");
const { AuthScreen } = await import("../AuthScreen");

/** Screens return null while `user` is still unresolved, so the component
 * type has to allow it. */
type ScreenComponent = () => JSX.Element | null;

const AXE_OPTIONS = { rules: { "color-contrast": { enabled: false } } };

afterEach(() => {
  earningsHidden = false;
  cleanup();
});

describe("screen accessibility", () => {
  const screens: [string, ScreenComponent][] = [
    ["Home", HomeScreen],
    ["Report", ReportScreen],
    ["History", HistoryScreen],
    ["Entry", EntryScreen],
    ["Auth", AuthScreen],
  ];

  for (const [name, Screen] of screens) {
    it(`${name} has no detectable violations`, async () => {
      const { container } = render(<Screen />);
      expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
    });
  }

  it("Report has no violations with earnings hidden", async () => {
    // The privacy toggle swaps rendered values for masked ones in the chart,
    // the tables and the hero figures at once — a state worth checking
    // separately, since it changes text content rather than just styling.
    earningsHidden = true;
    const { container } = render(<ReportScreen />);
    expect(await axe(container, AXE_OPTIONS)).toHaveNoViolations();
  });
});

describe("chart alternatives", () => {
  it("Home publishes the week's hours as a table, not only as bars", async () => {
    render(<HomeScreen />);
    const table = await screen.findByRole("table", { name: "Hours worked each day this week" });
    // Seven days, each a row with a header cell naming the day.
    expect(table.querySelectorAll("tbody tr")).toHaveLength(7);
    // And the drawing itself is not also announced, or every figure would be
    // read twice.
    expect(document.querySelector(".glance-bars")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("Report names its line chart and backs it with a table", async () => {
    render(<ReportScreen />);
    const chart = document.querySelector(".chart-svg")!;
    expect(chart.getAttribute("role")).toBe("img");
    expect(chart.getAttribute("aria-label")).toMatch(/Line chart of weekly earnings/);
    // Two tables can legitimately share this caption when the "compare
    // periods" control is on Weeks — the trend table and the period table
    // describe the same series. Assert on the one inside the trend card.
    await waitFor(() => expect(screen.getAllByRole("table", { name: /Weekly earnings, oldest first/ }).length).toBeGreaterThan(0));
  });

  it("Report's chart table masks earnings while the privacy toggle is on", async () => {
    earningsHidden = true;
    render(<ReportScreen />);
    const tables = screen.getAllByRole("table", { name: /earnings, oldest first/ });
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      const values = [...table.querySelectorAll("tbody td")].map((td) => td.textContent);
      expect(values.every((v) => v === "Hidden")).toBe(true);
      // The masked figures must not be sitting in the DOM in plain text either.
      expect(table.textContent).not.toMatch(/\$\d/);
    }
  });
});

describe("progress semantics", () => {
  it("Home's goal bar is a real progressbar with a settled value", async () => {
    render(<HomeScreen />);
    const bar = await screen.findByRole("progressbar", { name: /Hours toward goal/ });
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    // A real number, not the count-up animation's first frame.
    const now = Number(bar.getAttribute("aria-valuenow"));
    expect(Number.isFinite(now)).toBe(true);
    expect(now).toBeGreaterThan(0);
  });
});

describe("heading structure", () => {
  it("each screen has exactly one h1 and never skips a level", async () => {
    for (const [name, Screen] of [
      ["Home", HomeScreen],
      ["Report", ReportScreen],
      ["History", HistoryScreen],
      ["Entry", EntryScreen],
      ["Auth", AuthScreen],
    ] as [string, ScreenComponent][]) {
      const { container, unmount } = render(<Screen />);
      const levels = [...container.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => Number(h.tagName[1]));

      expect(levels.filter((l) => l === 1), `${name} should have exactly one h1`).toHaveLength(1);
      expect(levels[0], `${name} should open at h1`).toBe(1);
      for (let i = 1; i < levels.length; i++) {
        expect(levels[i] - levels[i - 1], `${name} skips a heading level`).toBeLessThanOrEqual(1);
      }
      unmount();
    }
  });
});
