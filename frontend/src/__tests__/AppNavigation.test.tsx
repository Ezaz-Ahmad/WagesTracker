// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../context/AppContext")>();
  return {
    ...actual,
    useApp: () => ({
      today: new Date("2026-08-28T12:00:00"),
      user: { id: "navigation-user", name: "Test User" },
      connected: true,
      actionError: null,
      sessionNotice: null,
      clearActionError: vi.fn(),
      dismissSessionNotice: vi.fn(),
      logout: vi.fn(),
      refresh: vi.fn(async () => {}),
      retryConnectivity: vi.fn(),
      earningsHidden: false,
      revealEarnings: vi.fn(),
      hideEarningsNow: vi.fn(),
    }),
  };
});

vi.mock("../screens/HomeScreen", () => ({ HomeScreen: () => <h1>Home screen</h1> }));
vi.mock("../screens/EntryScreen", () => ({ EntryScreen: () => <h1>Entry screen</h1> }));
vi.mock("../screens/SpendingScreen", () => ({ SpendingScreen: () => <h1>Spending screen</h1> }));
vi.mock("../screens/ReportScreen", () => ({ ReportScreen: () => <h1>Report screen</h1> }));
vi.mock("../screens/HistoryScreen", () => ({ HistoryScreen: () => <h1>History screen</h1> }));
vi.mock("../screens/SettingsScreen", () => ({ SettingsScreen: () => <h1>Settings screen</h1> }));

const { AuthedApp } = await import("../App");

afterEach(cleanup);
beforeEach(() => localStorage.clear());

it("starts every top-level destination at the top of the app scroller", async () => {
  const user = userEvent.setup();
  const { container } = render(<AuthedApp />);
  const main = container.querySelector(".app-main") as HTMLElement;

  await user.click(screen.getByRole("button", { name: "Entry" }));
  main.scrollTop = 560;
  await user.click(screen.getByRole("button", { name: "Spending" }));

  expect(screen.getByRole("heading", { name: "Spending screen" })).toBeTruthy();
  expect(main.scrollTop).toBe(0);
});

it("launches on a visible tab and swipes past hidden tabs", async () => {
  localStorage.setItem("wagesTracker.layout.v1:navigation-user", JSON.stringify({ hiddenTabs: ["home", "spending"] }));
  const { container } = render(<AuthedApp />);
  const main = container.querySelector(".app-main") as HTMLElement;
  expect(screen.getByRole("heading", { name: "Entry screen" })).toBeTruthy();
  const nav = screen.getByRole("navigation", { name: "Main" });
  expect(within(nav).queryByRole("button", { name: "Home" })).toBeNull();
  expect(within(nav).queryByRole("button", { name: "Spending" })).toBeNull();
  fireEvent.touchStart(main, { touches: [{ clientX: 240, clientY: 200 }] });
  fireEvent.touchMove(main, { touches: [{ clientX: 100, clientY: 200 }] });
  fireEvent.touchEnd(main);
  expect(screen.getByRole("heading", { name: "Report screen" })).toBeTruthy();
  expect(within(nav).getByRole("button", { name: "Report" }).getAttribute("aria-current")).toBe("page");
});

it("leaves Settings reachable even when every optional tab is hidden", () => {
  localStorage.setItem("wagesTracker.layout.v1:navigation-user", JSON.stringify({ hiddenTabs: ["home", "entry", "spending", "report", "history", "settings"] }));
  render(<AuthedApp />);
  expect(screen.getByRole("heading", { name: "Settings screen" })).toBeTruthy();
  expect(within(screen.getByRole("navigation", { name: "Main" })).getAllByRole("button").map((button) => button.textContent)).toEqual(["Settings"]);
});

it("leaves a newly hidden active screen when preferences change in another window", async () => {
  const user = userEvent.setup();
  render(<AuthedApp />);
  await user.click(screen.getByRole("button", { name: "Report" }));
  const next = JSON.stringify({ hiddenTabs: ["report"] });
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: "wagesTracker.layout.v1:navigation-user", newValue: next })));
  expect(screen.queryByRole("heading", { name: "Report screen" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Home screen" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Report" })).toBeNull();
});
