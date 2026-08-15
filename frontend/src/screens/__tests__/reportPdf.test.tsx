// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import type { WeekReportData } from "../../lib/reportData";
import type { Shift, User } from "../../lib/types";

type AppCtx = ReturnType<typeof useApp>;

const TODAY = new Date(2026, 1, 4, 10, 0, 0);
const USER: User = {
  id: "user-1",
  name: "Ezaz Ahmad",
  email: "ezaz@example.com",
  address: "",
  workLocationName: "Store",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Monday",
  rate: 10,
  goalHours: 40,
  goalEarnings: 400,
  createdAt: "2025-01-01T00:00:00.000Z",
};
const STALE_SHIFTS: Shift[] = [
  { id: "s1", date: "2026-02-02", location: "Store", signIn: "09:00", signOut: "11:00" },
];
const FRESH_SHIFTS: Shift[] = [
  { id: "s1", date: "2026-02-02", location: "Store", signIn: "09:00", signOut: "15:00" },
];

let generated: WeekReportData | null;

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return {
    ...actual,
    useApp: () =>
      ({
        user: USER,
        today: TODAY,
        shifts: STALE_SHIFTS,
        shiftsLoaded: true,
        dayExpenses: [],
        weekExtras: [],
        earningsHidden: false,
      }) as unknown as AppCtx,
  };
});

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    listShifts: vi.fn(async () => ({ shifts: FRESH_SHIFTS })),
    listDayExpenses: vi.fn(async () => ({ expenses: [{ date: "2026-02-02", fuelCost: 12.5 }] })),
    listWeekExtras: vi.fn(async () => ({ extras: [{ weekStart: "2026-02-02", amount: 25, reason: "Bonus" }] })),
  };
});

vi.mock("../../pdf/generateReportPdf", () => ({
  generateReportPdf: vi.fn(async (data: WeekReportData) => {
    generated = data;
  }),
}));

const { ReportScreen } = await import("../ReportScreen");
const api = await import("../../lib/api");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("current-week PDF download", () => {
  it("builds the report from freshly fetched current-week records", async () => {
    generated = null;
    const user = userEvent.setup();
    render(<ReportScreen />);

    // The screen begins with a stale two-hour context snapshot.
    expect(screen.getByText("2.00h")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /Download PDF/ }));
    await waitFor(() => expect(generated).not.toBeNull());

    expect(api.listShifts).toHaveBeenCalledWith("2026-02-02", "2026-02-08");
    expect(api.listDayExpenses).toHaveBeenCalledWith("2026-02-02", "2026-02-08");
    expect(api.listWeekExtras).toHaveBeenCalledWith("2026-02-02", "2026-02-08");
    expect(generated).toMatchObject({
      weekStartISO: "2026-02-02",
      weekEndISO: "2026-02-08",
      totalHours: 6,
      totalFuelCost: 12.5,
      otherEarningAmount: 25,
      otherEarningReason: "Bonus",
      totalEarnings: 97.5,
    });
  });

  it("guards rapid duplicate requests before the disabled state renders", async () => {
    render(<ReportScreen />);
    const button = screen.getByRole("button", { name: /Download PDF/ });

    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    await waitFor(() => expect(api.listShifts).toHaveBeenCalledOnce());
    expect(api.listDayExpenses).toHaveBeenCalledOnce();
    expect(api.listWeekExtras).toHaveBeenCalledOnce();
  });
});
