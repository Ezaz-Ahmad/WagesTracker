// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import { resetLiveClockForTests } from "../../lib/liveClock";
import type { User } from "../../lib/types";
import { ReportScreen } from "../ReportScreen";

type AppCtx = ReturnType<typeof useApp>;

const user: User = {
  id: "live-report-user", name: "Live User", email: "live@example.com", address: "",
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-20T12:00:00"));
  resetLiveClockForTests();
});

afterEach(() => {
  cleanup();
  resetLiveClockForTests();
  vi.useRealTimers();
});

describe("Report active-shift visuals", () => {
  it("updates the current chart point, bars, rings, and headline without remounting them", async () => {
    render(<ReportScreen />);

    expect(screen.getAllByText("$30.00").length).toBeGreaterThan(0);
    expect(document.querySelector(".chart-point.is-live")).toBeTruthy();
    expect(document.querySelector(".period-bar-col.is-live")).toBeTruthy();
    expect(document.querySelectorAll(".goal-ring.is-live")).toHaveLength(2);
    expect(document.querySelectorAll(".live-data-badge.is-active").length).toBeGreaterThanOrEqual(3);

    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

    expect(screen.getAllByText("$30.03").length).toBeGreaterThan(0);
    const trendTable = screen.getAllByRole("table", { name: /Weekly earnings, oldest first/ })[0];
    expect(trendTable.textContent).toContain("$30.03");
  });
});
