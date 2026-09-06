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
  it("explains the reliability and no-automatic-action safeguards", () => {
    render(<SmartShiftReminderSettings />);
    expect(screen.getByRole("switch", { name: "Smart shift reminders" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByText("20-min grace")).toBeTruthy();
    expect(screen.getByText("Reliable patterns only")).toBeTruthy();
    expect(screen.getByText("No automatic clocking")).toBeTruthy();
    expect(screen.getByText(/always open Wage Tracker for confirmation/i)).toBeTruthy();
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
    expect(screen.getByText(/3 of 4 Monday shifts recorded/)).toBeTruthy();

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
    expect(screen.getByText(/Ready — learning complete for 1 weekday routine/)).toBeTruthy();
  });
});
