// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  invalidateSpendingSummaries,
  resetSpendingDataCacheForTests,
  useSpendingSummary,
} from "../spendingDataCache";
import type { SpendingSummary } from "../types";

const getSummary = vi.hoisted(() => vi.fn());

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, getSpendingSummary: getSummary };
});

function summary(from: string, to: string, spending = 2550): SpendingSummary {
  return {
    period: { from, to, previousFrom: from, previousTo: to, days: 1 },
    earningsCents: 10_000,
    earningsRecorded: true,
    totalSpendingCents: spending,
    differenceCents: 10_000 - spending,
    spendingPercentage: spending / 100,
    averageDailyCents: spending,
    transactionCount: 1,
    largestCategory: null,
    previous: { earningsCents: 0, totalSpendingCents: 0, spendingChangePercent: null },
    categories: [],
    trend: [],
    recentExpenses: [],
  };
}

function Probe({ from, to }: { from: string; to: string }) {
  const state = useSpendingSummary("user-a", from, to);
  return (
    <div>
      <span data-testid="value">{state.data?.totalSpendingCents ?? "none"}</span>
      <span data-testid="loading">{String(state.loading)}</span>
      <span data-testid="error">{state.error ?? "none"}</span>
    </div>
  );
}

beforeEach(() => {
  resetSpendingDataCacheForTests();
  getSummary.mockReset();
});

afterEach(cleanup);

describe("spending summary session cache", () => {
  it("serves a previously loaded range immediately after unmount without another request", async () => {
    getSummary.mockResolvedValue(summary("2026-08-01", "2026-08-31"));
    const first = render(<Probe from="2026-08-01" to="2026-08-31" />);
    expect(screen.getByTestId("value").textContent).toBe("none");
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("2550"));
    expect(getSummary).toHaveBeenCalledTimes(1);
    first.unmount();

    render(<Probe from="2026-08-01" to="2026-08-31" />);
    expect(screen.getByTestId("value").textContent).toBe("2550");
    expect(screen.getByTestId("loading").textContent).toBe("false");
    expect(getSummary).toHaveBeenCalledTimes(1);
  });

  it("keys independent values by from and to", async () => {
    getSummary.mockImplementation((from: string, to: string) => Promise.resolve(summary(from, to, from.endsWith("01") ? 100 : 200)));
    const { rerender } = render(<Probe from="2026-08-01" to="2026-08-31" />);
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("100"));
    rerender(<Probe from="2026-08-20" to="2026-08-20" />);
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("200"));
    rerender(<Probe from="2026-08-01" to="2026-08-31" />);
    expect(screen.getByTestId("value").textContent).toBe("100");
    expect(getSummary).toHaveBeenCalledTimes(2);
  });

  it("keeps cached data visible when a background revalidation fails", async () => {
    getSummary.mockResolvedValueOnce(summary("2026-08-01", "2026-08-31"));
    render(<Probe from="2026-08-01" to="2026-08-31" />);
    await waitFor(() => expect(screen.getByTestId("value").textContent).toBe("2550"));

    getSummary.mockRejectedValueOnce(new Error("Refresh unavailable"));
    invalidateSpendingSummaries("user-a");
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("Refresh unavailable"));
    expect(screen.getByTestId("value").textContent).toBe("2550");
    expect(screen.getByTestId("loading").textContent).toBe("false");
  });
});
