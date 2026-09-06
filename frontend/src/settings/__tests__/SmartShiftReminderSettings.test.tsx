// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import { SmartShiftReminderSettings } from "../SmartShiftReminderSettings";

type AppCtx = ReturnType<typeof useApp>;
let enabled = false;
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
      smartReminderPatterns: [],
      smartReminderAuthorization: "unavailable",
      smartReminderScheduledCount: 0,
      setSmartRemindersEnabled: setEnabled,
    }) as unknown as AppCtx,
  };
});
afterEach(() => {
  cleanup();
  enabled = false;
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
});
