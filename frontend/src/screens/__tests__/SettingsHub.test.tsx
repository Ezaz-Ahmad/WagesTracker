// @vitest-environment jsdom
//
// Component tests for the Settings hub redesign (SettingsScreen +
// settings/*.tsx): category navigation, that each category shows its own
// distinct content, that draft edits survive switching categories, the
// save-result contract fix (genuine success vs. failure, disabled-when-
// unchanged), and that invalid numeric input is rejected rather than
// silently coerced to zero.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import type { User, WorkLocation } from "../../lib/types";
import { SettingsScreen } from "../SettingsScreen";

type AppCtx = ReturnType<typeof useApp>;

const testUser: User = {
  id: "user-1",
  name: "Test User",
  email: "test-user@example.com",
  address: "",
  workLocationName: "",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Monday",
  rate: 20,
  goalHours: 35,
  goalEarnings: 700,
  createdAt: "2026-01-01T00:00:00.000Z",
};

// Configurable per test, read live by the fake context hook — same pattern
// SettingsScreen.test.tsx already established.
let updateSettingsImpl: (patch: unknown) => Promise<void>;
let workLocationsImpl: WorkLocation[] = [];
let createWorkLocationImpl: ReturnType<typeof vi.fn>;
let updateWorkLocationImpl: ReturnType<typeof vi.fn>;
let archiveWorkLocationImpl: ReturnType<typeof vi.fn>;

function useFakeApp(): AppCtx {
  return {
    user: testUser,
    updateSettings: (patch: unknown) => updateSettingsImpl(patch),
    changePassword: vi.fn().mockResolvedValue(undefined),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    sessions: [],
    sessionsLoading: false,
    sessionsError: null,
    loadSessions: vi.fn().mockResolvedValue(undefined),
    revokeSession: vi.fn().mockResolvedValue(undefined),
    revokeOtherSessions: vi.fn().mockResolvedValue(undefined),
    workLocations: workLocationsImpl,
    workLocationsLoading: false,
    createWorkLocation: createWorkLocationImpl,
    updateWorkLocation: updateWorkLocationImpl,
    archiveWorkLocation: archiveWorkLocationImpl,
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

beforeEach(() => {
  updateSettingsImpl = vi.fn().mockResolvedValue(undefined);
  workLocationsImpl = [];
  createWorkLocationImpl = vi.fn().mockResolvedValue(undefined);
  updateWorkLocationImpl = vi.fn().mockResolvedValue(undefined);
  archiveWorkLocationImpl = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Settings hub — category navigation", () => {
  it("shows Profile & preferences by default, with a labeled name field", () => {
    render(<SettingsScreen />);
    expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeTruthy();
    expect(screen.getByLabelText("Your name")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Customise app layout" })).toBeTruthy();
  });

  it("opens layout customisation from Profile & preferences", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);

    await user.click(screen.getByRole("button", { name: "Customise app layout" }));
    expect(screen.getByRole("dialog", { name: "Customise your layout" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Tab bar" })).toBeTruthy();
  });

  it("shows distinct content for each category and marks the active one aria-current", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);

    await user.click(screen.getByRole("button", { name: /work & pay/i }));
    expect(screen.getByLabelText(/Hourly rate/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /work & pay/i }).getAttribute("aria-current")).toBe("page");

    await user.click(screen.getByRole("button", { name: /weekly goals/i }));
    expect(screen.getByLabelText("Weekly hours goal")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /security/i }));
    expect(screen.getByLabelText("Current password")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /data & account/i }));
    expect(screen.getByText(/Permanently delete your profile, settings, sessions, shifts, expenses/)).toBeTruthy();
  });

  it("keeps an unsaved draft edit when navigating away from and back to a category", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);

    const nameInput = screen.getByLabelText("Your name") as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, "Changed Name");

    await user.click(screen.getByRole("button", { name: /work & pay/i }));
    await user.click(screen.getByRole("button", { name: /profile & preferences/i }));

    expect((screen.getByLabelText("Your name") as HTMLInputElement).value).toBe("Changed Name");
  });

  it("offers all seven week starts and explains the selected cycle dynamically", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);

    const select = screen.getByLabelText("Week starts on") as HTMLSelectElement;
    expect(Array.from(select.options).map((option) => option.value)).toEqual([
      "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
    ]);
    expect(screen.getByText(/weekly cycle across earnings, goals, history, reports and spending/i)).toBeTruthy();

    await user.selectOptions(select, "Tuesday");
    expect(screen.getByText("Your week runs Tuesday to Monday.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(updateSettingsImpl).toHaveBeenCalledWith(expect.objectContaining({ weekStartsOn: "Tuesday" })));
  });
});

describe("Settings hub — save-result contract", () => {
  it("disables Save until something changes, and disables it again after a genuine save", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);

    const saveBtn = screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);

    await user.type(screen.getByLabelText("Your name"), " Jr.");
    expect(saveBtn.disabled).toBe(false);

    await user.click(saveBtn);
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
    expect((screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("never shows Saved when the save actually fails, and shows an inline error instead", async () => {
    updateSettingsImpl = vi.fn().mockRejectedValue(new Error("Couldn't reach the server. Check your connection and try again."));
    const user = userEvent.setup();
    render(<SettingsScreen />);

    await user.type(screen.getByLabelText("Your name"), " Jr.");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText("Couldn't reach the server. Check your connection and try again.")).toBeTruthy());
    expect(screen.queryByText("Saved")).toBeNull();
    // Still dirty — the unsaved edit must not be discarded on a failed save.
    expect((screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables saving buttons while a save is in flight", async () => {
    let resolveSave: () => void = () => {};
    updateSettingsImpl = () => new Promise((resolve) => { resolveSave = () => resolve(undefined); });
    const user = userEvent.setup();
    render(<SettingsScreen />);

    await user.type(screen.getByLabelText("Your name"), " Jr.");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect((screen.getByRole("button", { name: /saving/i }) as HTMLButtonElement).disabled).toBe(true);
    resolveSave();
    await waitFor(() => expect(screen.getByText("Saved")).toBeTruthy());
  });
});

describe("Settings hub — numeric validation", () => {
  it("rejects non-numeric rate input without silently coercing it to zero", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await user.click(screen.getByRole("button", { name: /work & pay/i }));

    const rateInput = screen.getByLabelText(/Hourly rate/) as HTMLInputElement;
    await user.clear(rateInput);
    await user.type(rateInput, "abc");

    expect(rateInput.value).toBe("abc"); // never silently replaced with 0
    expect(screen.getByText("Enter a valid number")).toBeTruthy();
    expect((screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("accepts a valid decimal rate and enables Save", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await user.click(screen.getByRole("button", { name: /work & pay/i }));

    const rateInput = screen.getByLabelText(/Hourly rate/) as HTMLInputElement;
    await user.clear(rateInput);
    await user.type(rateInput, "27.5");

    expect((screen.getByRole("button", { name: /save changes/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("requires an allowance amount when enabled and sends a normalized branch payload", async () => {
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await user.click(screen.getByRole("button", { name: /work & pay/i }));
    await user.click(screen.getByRole("button", { name: /add location/i }));

    const allowanceToggle = screen.getByRole("checkbox", { name: /receive a fuel allowance/i });
    await user.click(allowanceToggle);
    expect(screen.getByText("Enter the fuel allowance for this branch.")).toBeTruthy();
    expect((screen.getByRole("button", { name: /save location/i }) as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByLabelText("Location name"), "North branch");
    await user.type(screen.getByLabelText(/Fuel allowance per worked day/), "15.25");
    await user.click(screen.getByRole("button", { name: /save location/i }));
    await waitFor(() => expect(createWorkLocationImpl).toHaveBeenCalledWith({
      name: "North branch",
      address: "",
      fuelAllowance: 15.25,
    }));
  });

  it("clears the allowance when an existing branch is switched to No", async () => {
    workLocationsImpl = [{
      id: "loc-1",
      name: "Downtown",
      address: "1 Main St",
      fuelAllowance: 12.5,
      archived: false,
      archivedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }];
    const user = userEvent.setup();
    render(<SettingsScreen />);
    await user.click(screen.getByRole("button", { name: /work & pay/i }));
    await user.click(screen.getByRole("button", { name: /^edit$/i }));
    const allowanceToggle = screen.getByRole("checkbox", { name: /receive a fuel allowance/i });
    expect((allowanceToggle as HTMLInputElement).checked).toBe(true);
    await user.click(allowanceToggle);
    expect(screen.queryByLabelText(/Fuel allowance per worked day/)).toBeNull();
    await user.click(screen.getByRole("button", { name: /save location/i }));
    await waitFor(() => expect(updateWorkLocationImpl).toHaveBeenCalledWith("loc-1", {
      name: "Downtown",
      address: "1 Main St",
      fuelAllowance: null,
    }));
  });
});
