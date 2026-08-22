// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import type { SpendingSummary, User } from "../../lib/types";
import { resetSpendingDataCacheForTests } from "../../lib/spendingDataCache";
import { HomeScreen } from "../HomeScreen";

type AppCtx = ReturnType<typeof useApp>;

const getSpendingSummary = vi.hoisted(() => vi.fn());

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, getSpendingSummary };
});

const testUser: User = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  address: "",
  workLocationName: "Store",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Monday",
  rate: 25,
  goalHours: 35,
  goalEarnings: 700,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function useFakeApp(): AppCtx {
  return {
    today: new Date(2026, 7, 20, 12, 0),
    user: testUser,
    shifts: [],
    shiftsLoaded: true,
    dayExpenses: [],
    weekExtras: [],
    earningsHidden: false,
    createShift: vi.fn().mockResolvedValue(undefined),
    updateShift: vi.fn().mockResolvedValue(undefined),
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

const monthlySummary: SpendingSummary = {
  period: { from: "2026-08-01", to: "2026-08-31", previousFrom: "2026-07-01", previousTo: "2026-07-31", days: 31 },
  earningsCents: 100_000,
  earningsRecorded: true,
  totalSpendingCents: 25_500,
  differenceCents: 74_500,
  spendingPercentage: 25.5,
  averageDailyCents: 823,
  transactionCount: 3,
  largestCategory: { id: "groceries", name: "Groceries", icon: "groceries", colour: "#047857", totalCents: 20_000, transactionCount: 2 },
  previous: { earningsCents: 90_000, totalSpendingCents: 30_000, spendingChangePercent: -15 },
  categories: [
    { id: "groceries", name: "Groceries", icon: "groceries", colour: "#047857", totalCents: 20_000, transactionCount: 2 },
    { id: "dining", name: "Dining", icon: "dining", colour: "#B45309", totalCents: 5_500, transactionCount: 1 },
  ],
  trend: [{ date: "2026-08-19", totalCents: 25_500 }],
  recentExpenses: [],
};

beforeEach(() => {
  resetSpendingDataCacheForTests();
  getSpendingSummary.mockReset();
  getSpendingSummary.mockResolvedValue(monthlySummary);
});

afterEach(cleanup);

describe("Home monthly personal-spending snapshot", () => {
  it("reserves the donut, legend, values, and action geometry on the first load", () => {
    getSpendingSummary.mockReturnValue(new Promise(() => {}));
    const { container } = render(<HomeScreen />);
    expect(screen.getByLabelText("Loading this month's spending")).toBeTruthy();
    expect(container.querySelector(".home-spending-skeleton .is-donut")).toBeTruthy();
    expect(container.querySelectorAll(".home-spending-skeleton-legend .is-line")).toHaveLength(4);
    expect(container.querySelectorAll(".home-spending-skeleton .home-spending-values > div")).toHaveLength(3);
    expect(screen.queryByText("Loading this month's spending…")).toBeNull();
  });

  it("shows the cached monthly snapshot synchronously after a remount", async () => {
    const first = render(<HomeScreen />);
    await screen.findByText("Groceries");
    expect(getSpendingSummary).toHaveBeenCalledTimes(1);
    first.unmount();
    render(<HomeScreen />);
    expect(screen.getByText("Groceries")).toBeTruthy();
    expect(screen.queryByLabelText("Loading this month's spending")).toBeNull();
    expect(getSpendingSummary).toHaveBeenCalledTimes(1);
  });

  it("requests the complete current calendar month and renders a compact category snapshot", async () => {
    const navigate = vi.fn();
    render(<HomeScreen onNavigate={navigate} />);

    await waitFor(() => expect(getSpendingSummary).toHaveBeenCalledWith("2026-08-01", "2026-08-31"));
    expect(await screen.findByRole("heading", { name: "Personal spending — August" })).toBeTruthy();
    expect(screen.getByText("Groceries")).toBeTruthy();
    expect(screen.getByText("78%")).toBeTruthy();
    expect(screen.getByText("22%")).toBeTruthy();
    expect(screen.getByText("$255.00")).toBeTruthy();
    expect(screen.getByRole("button", { name: /View full spending dashboard/ })).toBeTruthy();
  });
});
