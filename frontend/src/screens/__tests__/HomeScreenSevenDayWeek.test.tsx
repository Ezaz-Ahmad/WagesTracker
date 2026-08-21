// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import type { User } from "../../lib/types";
import { HomeScreen } from "../HomeScreen";

type AppCtx = ReturnType<typeof useApp>;

const user: User = {
  id: "tuesday-user",
  name: "Tuesday User",
  email: "tuesday@example.com",
  address: "",
  workLocationName: "Store",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Tuesday",
  rate: 20,
  goalHours: 10,
  goalEarnings: 250,
  createdAt: "2026-01-01T00:00:00.000Z",
};

function useFakeApp(): AppCtx {
  return {
    today: new Date(2026, 7, 19, 12, 0, 0), // Wednesday
    user,
    shifts: [
      // Monday belongs to the completed Tuesday 11 -> Monday 17 cycle.
      { id: "previous", date: "2026-08-17", location: "Store", signIn: "09:00", signOut: "19:00" },
      { id: "current-a", date: "2026-08-18", location: "Store", signIn: "09:00", signOut: "13:00" },
      { id: "current-b", date: "2026-08-19", location: "Store", signIn: "09:00", signOut: "13:00" },
    ],
    shiftsLoaded: true,
    dayExpenses: [{ date: "2026-08-18", fuelCost: 10 }],
    weekExtras: [{ weekStart: "2026-08-18", amount: 20, reason: "Bonus" }],
    earningsHidden: false,
    createShift: vi.fn().mockResolvedValue(undefined),
    updateShift: vi.fn().mockResolvedValue(undefined),
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HomeScreen with a Tuesday-start week", () => {
  it("uses Tuesday–Monday for totals, expenses, extras, goals and the prior-week comparison", () => {
    render(<HomeScreen />);

    // 8h × $20 + $10 fuel + $20 weekly extra.
    expect(screen.getByText("$190.00")).toBeTruthy();
    expect(screen.getByText(/^8\.00h logged/)).toBeTruthy();
    expect(screen.getByText("80%")).toBeTruthy();

    // Previous Tuesday–Monday earned $200, proving Aug 17 was compared as
    // the prior cycle instead of being folded into the current total.
    expect(screen.getByText(/5% vs prior week/)).toBeTruthy();
  });
});
