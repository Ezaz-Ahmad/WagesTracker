// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmProvider } from "../../components/ConfirmProvider";
import { resetLiveClockForTests } from "../../lib/liveClock";
import { resetSpendingDataCacheForTests } from "../../lib/spendingDataCache";
import type { useApp } from "../../context/AppContext";
import type { SpendingSummary, User } from "../../lib/types";
import { HomeScreen } from "../HomeScreen";

type AppCtx = ReturnType<typeof useApp>;
const buildHistory = vi.hoisted(() => vi.fn());
const getSummary = vi.hoisted(() => vi.fn());

vi.mock("../../lib/aggregate", async () => {
  const actual = await vi.importActual<typeof import("../../lib/aggregate")>("../../lib/aggregate");
  buildHistory.mockImplementation(actual.buildWeeklyHistory);
  return { ...actual, buildWeeklyHistory: buildHistory };
});

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return { ...actual, getSpendingSummary: getSummary };
});

const user: User = {
  id: "active-user", name: "Active User", email: "active@example.com", address: "",
  workLocationName: "Store", workAddress: "", multipleLocations: false, otherLocations: "",
  weekStartsOn: "Monday", rate: 30, goalHours: 35, goalEarnings: 700,
  createdAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return {
    ...actual,
    useApp: () => ({
      today: new Date("2026-08-20T12:00:00"),
      user,
      shifts: [{ id: "open", date: "2026-08-20", location: "Store", signIn: "11:00:00", signOut: null }],
      shiftsLoaded: true,
      dayExpenses: [],
      weekExtras: [],
      earningsHidden: false,
      createShift: vi.fn(),
      updateShift: vi.fn(),
    } as unknown as AppCtx),
  };
});

const monthlySummary: SpendingSummary = {
  period: { from: "2026-08-01", to: "2026-08-31", previousFrom: "2026-07-01", previousTo: "2026-07-31", days: 31 },
  earningsCents: 100_000, earningsRecorded: true, totalSpendingCents: 25_500, differenceCents: 74_500,
  spendingPercentage: 25.5, averageDailyCents: 823, transactionCount: 0, largestCategory: null,
  previous: { earningsCents: 0, totalSpendingCents: 0, spendingChangePercent: null }, categories: [], trend: [], recentExpenses: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-20T12:00:00"));
  buildHistory.mockClear();
  getSummary.mockReset();
  getSummary.mockResolvedValue(monthlySummary);
  resetLiveClockForTests();
  resetSpendingDataCacheForTests();
});

afterEach(() => {
  cleanup();
  resetLiveClockForTests();
  resetSpendingDataCacheForTests();
  vi.useRealTimers();
});

describe("Home active-shift rendering", () => {
  it("updates the timer and live earnings without rerunning the HomeScreen aggregate tree", async () => {
    render(<ConfirmProvider><HomeScreen /></ConfirmProvider>);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(screen.getByText("No expenses recorded this month.")).toBeTruthy();
    const aggregateCallsAfterLoad = buildHistory.mock.calls.length;
    expect(screen.getByText("01:00:00")).toBeTruthy();

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    expect(screen.getByText(/01:00:0[2-3]/)).toBeTruthy();
    expect(screen.getByText("$30.03")).toBeTruthy();
    expect(buildHistory).toHaveBeenCalledTimes(aggregateCallsAfterLoad);
  });
});
