// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../context/AppContext")>();
  return {
    ...actual,
    useApp: () => ({
      today: new Date("2026-08-28T12:00:00"),
      user: { name: "Test User" },
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
