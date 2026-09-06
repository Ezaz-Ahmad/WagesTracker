// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import type { SmartShiftPattern } from "../../lib/smartShiftReminders";
import type { Shift } from "../../lib/types";
import { SmartShiftReminderSettings } from "../SmartShiftReminderSettings";

type AppCtx = ReturnType<typeof useApp>;
let enabled = false;
let patterns: SmartShiftPattern[] = [];
let shifts: Shift[] = [];
const setEnabled = vi.fn(async (value: boolean) => { enabled = value; });

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return {
    ...actual,
    useApp: () => ({
      user: {
        id: "u1", name: "Ezaz Ahmad", email: "ezaz@example.com", address: "",
        workLocationName: "", workAddress: "", multipleLocations: false, otherLocations: "",
        weekStartsOn: "Monday", rate: 30, goalHours: 38, goalEarnings: 1_100,
        smartRemindersEnabled: enabled, createdAt: "2026-01-01T00:00:00Z",
      },
      smartReminderPatterns: patterns,
      smartReminderAuthorization: "unavailable",
      smartReminderScheduledCount: 0,
      setSmartRemindersEnabled: setEnabled,
      shifts,
    }) as unknown as AppCtx,
  };
});
afterEach(() => {
  cleanup();
  enabled = false;
  patterns = [];
  shifts = [];
  setEnabled.mockClear();
});

describe("SmartShiftReminderSettings", () => {
  it("keeps the preference helpful without exposing internal scheduling rules", () => {
    render(<SmartShiftReminderSettings />);
    expect(screen.getByRole("switch", { name: "Smart shift reminders" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText(/helpful reminders around your usual shifts/i)).toBeTruthy();
    expect(screen.getByText(/stay quiet when your routine isn't clear/i)).toBeTruthy();
    expect(screen.queryByText(/20-min grace/i)).toBeNull();
    expect(screen.queryByText(/no automatic clocking/i)).toBeNull();
    expect(screen.queryByText(/at least four/i)).toBeNull();
  });

  it("persists an explicit opt-in", async () => {
    const user = userEvent.setup();
    render(<SmartShiftReminderSettings />);
    await user.click(screen.getByRole("switch", { name: "Smart shift reminders" }));
    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  it("shows useful existing-history progress and a clear ready state", () => {
    enabled = true;
    shifts = [
      { id: "1", date: "2026-08-17", location: "Central", signIn: "08:00", signOut: "17:00" },
      { id: "2", date: "2026-08-24", location: "Central", signIn: "08:02", signOut: "17:01" },
      { id: "3", date: "2026-08-31", location: "Central", signIn: "07:59", signOut: "17:03" },
    ];
    const first = render(<SmartShiftReminderSettings />);
    expect(screen.getByText("Learning your routine")).toBeTruthy();
    expect(screen.getByText(/completed Monday shifts/i)).toBeTruthy();
    expect(screen.queryByText(/3 of 4/i)).toBeNull();

    first.unmount();
    patterns = [{
      weekday: 1,
      weekdayName: "Monday",
      sampleSize: 4,
      usualStartMinutes: 480,
      usualEndOffsetMinutes: 1020,
      startSpreadMinutes: 4,
      endSpreadMinutes: 3,
    }];
    render(<SmartShiftReminderSettings />);
    expect(screen.getByText(/ready for your Monday routine/i)).toBeTruthy();
    expect(screen.getByText("Your usual shifts")).toBeTruthy();
    expect(screen.getByText((_, element) => (
      !!element?.classList.contains("smart-reminder-routine-time")
      && element.textContent === "8:00 AM – 5:00 PM"
    ))).toBeTruthy();
  });
});
