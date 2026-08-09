// @vitest-environment jsdom
//
// Regression test for the week-boundary half of the midnight-rollover bug:
// an open overnight shift's live elapsed hours must only count toward the
// week that actually contains its *starting* date (see isDateInWeek in
// aggregate.ts), not whichever week happens to be on screen when "today"
// ticks over. Without this, a shift that starts the night before a week
// boundary would show its live hours in the new week first, then have them
// vanish from view and reappear in the previous week's total the moment
// it's signed out and actually saved under its real date — a visible
// backward jump this test exists to catch.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import type { Shift, User } from "../../lib/types";
import { HomeScreen } from "../HomeScreen";

type AppCtx = ReturnType<typeof useApp>;

const testUser: User = {
  id: "user-1",
  name: "Test User",
  email: "test-user@example.com",
  address: "",
  workLocationName: "Downtown Store",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Monday", // the week starts Monday, so Sunday belongs to the *previous* week
  rate: 20,
  goalHours: 35,
  goalEarnings: 700,
  createdAt: "2026-01-01T00:00:00.000Z",
};

// Signed in 10:00 PM Sunday Jan 4, 2026 — still open. "today" below is
// Monday Jan 5, 01:30 AM: the date has already rolled into a new
// Monday-starting week, but this shift's own date (Jan 4) has not.
const overnightAcrossWeekBoundary: Shift = {
  id: "shift-sunday",
  date: "2026-01-04",
  location: "Downtown Store",
  signIn: "22:00:00",
  signOut: null,
};

function useFakeApp(): AppCtx {
  return {
    today: new Date("2026-01-05T01:30:00"),
    user: testUser,
    shifts: [overnightAcrossWeekBoundary],
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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HomeScreen — open shift across a week boundary", () => {
  it("does not count the open shift's live hours toward the new week's total, since it started in the previous week", () => {
    render(<HomeScreen />);

    // The shift is still correctly recognized as active/in-progress...
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
    expect(screen.getByText("Shift in progress")).toBeTruthy();

    // ...but none of its live hours should be attributed to *this* week's
    // total, since its actual date (Jan 4, a Sunday) belongs to the
    // previous Monday-starting week, not this one. Before the fix, this
    // would show roughly 3.5h (22:00 -> 01:30) logged for a week that, on
    // its own saved data, has nothing in it yet.
    expect(screen.getByText(/^0\.00h logged/)).toBeTruthy();
  });
});
