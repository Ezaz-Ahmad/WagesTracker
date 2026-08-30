// @vitest-environment jsdom
//
// Regression test for the Entry screen's day accordion: the accordion
// trigger used to be a `<div role="button">` with the separate "Clear"
// button nested *inside* it — a `<button>` inside another interactive
// element is an invalid pattern that assistive tech and keyboard handling
// can't reliably deal with (activating the outer one can also trigger or
// confuse focus on the inner one). It's now a real `<button>` for the
// trigger, with Clear as a sibling action instead — this proves that
// structure directly, plus that keyboard (Enter) toggling and aria-expanded
// still work, and that clicking Clear doesn't also flip the accordion open/
// closed as a side effect of whatever DOM nesting is present.
//
// Every day card actually renders with a "has-content"-style Clear button
// regardless of whether it has a real shift — buildDayComputed (aggregate.ts)
// fills an empty day with one synthetic placeholder row so the week always
// has 7 rows, and dayHasContent only checks `day.shifts.length > 0`, which
// that placeholder always satisfies. That's pre-existing shift-display
// behavior this correction pass explicitly must not touch, so this test
// locates the specific day that actually has the real shift by its date
// label, rather than assuming the first "has-content" card is the
// meaningful one.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import type { DayExpense, Shift, User, WorkLocation } from "../../lib/types";
import { isoDate } from "../../lib/date";
import { EntryScreen } from "../EntryScreen";
import { ConfirmProvider } from "../../components/ConfirmProvider";
import * as api from "../../lib/api";

type AppCtx = ReturnType<typeof useApp>;

const today = new Date("2026-01-07T12:00:00"); // a Wednesday
const todayISO = isoDate(today);

const testUser: User = {
  id: "user-1",
  name: "Test User",
  email: "test-user@example.com",
  address: "",
  workLocationName: "Cafe",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Monday",
  rate: 20,
  goalHours: 35,
  goalEarnings: 700,
  createdAt: "2026-01-01T00:00:00.000Z",
};

// One real shift, on "today" (Wed, Jan 7) — its card is the one every test
// below inspects, found via its "Jan 7" date label.
const testShift: Shift = { id: "shift-1", date: todayISO, location: "Cafe", signIn: "09:00", signOut: "17:00" };

let removeShift: ReturnType<typeof vi.fn>;
let updateShift: ReturnType<typeof vi.fn>;
let createShift: ReturnType<typeof vi.fn>;
let fakeShifts: Shift[];
let fakeLocations: WorkLocation[];
let fakeDayExpenses: DayExpense[];

const activeLocation: WorkLocation = {
  id: "location-1",
  name: "Cafe",
  address: "",
  fuelAllowance: 12.5,
  archived: false,
  archivedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const warehouseLocation: WorkLocation = {
  ...activeLocation,
  id: "location-2",
  name: "Harbour Warehouse",
  address: "18 Wharf Road, Newcastle NSW",
  fuelAllowance: 18.75,
};

function useFakeApp(): AppCtx {
  return {
    today,
    user: testUser,
    shifts: fakeShifts,
    shiftsLoaded: true,
    createShift,
    updateShift,
    removeShift,
    dayExpenses: fakeDayExpenses,
    setFuelCost: vi.fn().mockResolvedValue(undefined),
    weekExtras: [],
    setWeekExtra: vi.fn().mockResolvedValue(true),
    earningsHidden: false,
    revealEarnings: vi.fn(),
    workLocations: fakeLocations,
    workLocationsLoading: false,
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

beforeEach(() => {
  removeShift = vi.fn().mockResolvedValue(undefined);
  updateShift = vi.fn().mockResolvedValue(undefined);
  createShift = vi.fn().mockResolvedValue(undefined);
  fakeShifts = [testShift];
  fakeLocations = [activeLocation];
  fakeDayExpenses = [];
  vi.spyOn(api, "getWorkLocationSuggestions").mockResolvedValue({ suggestions: {} });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The day card containing the real shift — found by its date label text
 * ("Jan 7") rather than by a "has-content" class, since (see file banner
 * comment) every day card carries that class regardless of real content. */
function getShiftDayCard(): HTMLElement {
  const dateLabel = screen.getByText("Jan 7", { selector: ".day-date" });
  return dateLabel.closest(".day-card") as HTMLElement;
}

describe("Entry screen — day accordion structure and keyboard behavior", () => {
  it("keeps a time-wheel draft local until the picker is committed", async () => {
    const user = userEvent.setup();
    render(<ConfirmProvider><EntryScreen /></ConfirmProvider>);
    const card = getShiftDayCard();
    await user.click(card.querySelector(".day-row-toggle") as HTMLButtonElement);

    const signOut = within(card).getByLabelText("Sign-out time") as HTMLInputElement;
    fireEvent.change(signOut, { target: { value: "16:30" } });
    expect(updateShift).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();

    // The native Done/check action dismisses the time control and blurs it;
    // only then should the completed value reach the API.
    fireEvent.blur(signOut);
    await waitFor(() => expect(updateShift).toHaveBeenCalledWith("shift-1", { signOut: "16:30" }));
  });

  it("does not turn a historical sign-in-only draft into an active shift", async () => {
    const user = userEvent.setup();
    render(<ConfirmProvider><EntryScreen /></ConfirmProvider>);
    const card = screen.getByText("Jan 6", { selector: ".day-date" }).closest(".day-card") as HTMLElement;
    await user.click(card.querySelector(".day-row-toggle") as HTMLButtonElement);
    await user.click(within(card).getByRole("button", { name: "+ Add another shift" }));

    const signIn = within(card).getAllByLabelText("Sign-in time").at(-1) as HTMLInputElement;
    const signOut = within(card).getAllByLabelText("Sign-out time").at(-1) as HTMLInputElement;
    fireEvent.change(signIn, { target: { value: "09:00" } });
    fireEvent.blur(signIn);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(createShift).not.toHaveBeenCalled();

    fireEvent.change(signOut, { target: { value: "17:00" } });
    fireEvent.blur(signOut);
    await waitFor(() => expect(createShift).toHaveBeenCalledWith(expect.objectContaining({
      date: "2026-01-06",
      signIn: "09:00",
      signOut: "17:00",
    })));
  });
  it("uses a real <button> trigger (not a div role=button) with Clear as a sibling, not nested inside it", () => {
    render(<EntryScreen />);
    const card = getShiftDayCard();

    const toggle = card.querySelector(".day-row-toggle");
    expect(toggle).toBeTruthy();
    expect(toggle!.tagName).toBe("BUTTON");
    expect(toggle!.getAttribute("aria-expanded")).toBe("false");

    const clearBtn = card.querySelector(".day-clear-btn");
    expect(clearBtn).toBeTruthy();
    expect(clearBtn!.tagName).toBe("BUTTON");
    // The real regression check: Clear must NOT be a descendant of the
    // toggle button — it previously was, which is the invalid
    // button-inside-a-clickable-element pattern this fix removes.
    expect(toggle!.contains(clearBtn)).toBe(false);
  });

  it("opens and closes via mouse click, toggling aria-expanded", async () => {
    const user = userEvent.setup();
    render(<EntryScreen />);
    const toggle = getShiftDayCard().querySelector(".day-row-toggle") as HTMLButtonElement;

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("is fully keyboard-operable: Enter toggles it the same way a click does", async () => {
    const user = userEvent.setup();
    render(<EntryScreen />);
    const toggle = getShiftDayCard().querySelector(".day-row-toggle") as HTMLButtonElement;

    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("clicking Clear removes the shift without also toggling the accordion open", async () => {
    render(<EntryScreen />);
    const card = getShiftDayCard();
    const toggle = card.querySelector(".day-row-toggle") as HTMLButtonElement;
    const clearBtn = card.querySelector(".day-clear-btn") as HTMLButtonElement;

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(clearBtn);

    await waitFor(() => expect(removeShift).toHaveBeenCalledWith("shift-1"));
    // Clear is a sibling action, not part of the disclosure toggle — using
    // it must not have any side effect on the accordion's open/closed state.
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("uses the prior week's persisted branch as a suggestion without creating an unsaved shift", async () => {
    vi.mocked(api.getWorkLocationSuggestions).mockResolvedValue({ suggestions: { "2026-01-08": [activeLocation.id] } });
    const user = userEvent.setup();
    render(<EntryScreen />);
    const emptyCard = screen.getByText("Jan 8", { selector: ".day-date" }).closest(".day-card") as HTMLElement;
    await user.click(emptyCard.querySelector(".day-row-toggle") as HTMLButtonElement);

    const location = within(emptyCard).getByRole("button", { name: /Location for Thu Jan 8: Cafe/i });
    expect(location.textContent).toContain("Cafe");
    expect(within(emptyCard).getByText(/\$12\.50 is ready from the selected location/i)).toBeTruthy();
    const previewAmount = within(emptyCard).getByRole("button", { name: /Preview fuel allowance.*current value \$12\.50.*applied after sign-in/i });
    expect(previewAmount.textContent).toContain("$12.50");
    expect(createShift).not.toHaveBeenCalled();

    await user.click(previewAmount);
    const amountPicker = await screen.findByRole("dialog", { name: /Fuel allowance — Thu Jan 8/i });
    expect(within(amountPicker).getByText("$12.50", { selector: ".wheel-readout" })).toBeTruthy();
    await user.click(within(amountPicker).getByRole("button", { name: "Cancel" }));

    await user.click(location);
    const picker = await screen.findByRole("dialog", { name: /Choose a location — Thu Jan 8/i });
    expect(within(picker).getByText("$12.50 fuel allowance per worked day")).toBeTruthy();
    expect(createShift).not.toHaveBeenCalled();
  });

  it("shows location details in the responsive picker and updates a saved shift only after selection", async () => {
    fakeShifts = [{ ...testShift, workLocationId: activeLocation.id, fuelAllowanceSnapshot: activeLocation.fuelAllowance }];
    fakeLocations = [activeLocation, warehouseLocation];
    updateShift.mockResolvedValue({
      ...testShift,
      workLocationId: warehouseLocation.id,
      location: warehouseLocation.name,
      fuelAllowanceSnapshot: warehouseLocation.fuelAllowance,
    });
    const user = userEvent.setup();
    render(<EntryScreen />);
    const card = getShiftDayCard();
    await user.click(card.querySelector(".day-row-toggle") as HTMLButtonElement);

    await user.click(within(card).getByRole("button", { name: /Location for Wed Jan 7: Cafe/i }));
    const picker = await screen.findByRole("dialog", { name: /Choose a location — Wed Jan 7/i });
    const warehouse = within(picker).getByRole("button", { name: /Harbour Warehouse/i });
    expect(warehouse.textContent).toContain("18 Wharf Road, Newcastle NSW");
    expect(warehouse.textContent).toContain("$18.75 fuel allowance per worked day");

    await user.click(warehouse);
    await waitFor(() => expect(updateShift).toHaveBeenCalledWith("shift-1", {
      workLocationId: warehouseLocation.id,
      location: "",
    }));
  });

  it("keeps an explicit clock-in location instead of restoring the remembered suggestion", async () => {
    fakeLocations = [activeLocation, warehouseLocation];
    vi.mocked(api.getWorkLocationSuggestions).mockResolvedValue({
      suggestions: { [todayISO]: [activeLocation.id] },
    });
    const user = userEvent.setup();
    render(<EntryScreen />);

    const clockLocation = await screen.findByRole("button", { name: /Today's work location: Cafe/i });
    await user.click(clockLocation);
    const picker = await screen.findByRole("dialog", { name: /Choose today's work location/i });
    await user.click(within(picker).getByRole("button", { name: /Harbour Warehouse/i }));

    expect(screen.getByRole("button", { name: /Today's work location: Harbour Warehouse/i })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(createShift).toHaveBeenCalledWith(expect.objectContaining({
      date: todayISO,
      workLocationId: warehouseLocation.id,
      location: warehouseLocation.name,
    })));
  });

  it("shows a saved automatic allowance in the fuel section and keeps it editable", async () => {
    fakeShifts = [{ ...testShift, workLocationId: activeLocation.id, fuelAllowanceSnapshot: activeLocation.fuelAllowance }];
    fakeDayExpenses = [{
      date: todayISO,
      fuelCost: 12.5,
      automaticFuelAllowance: 12.5,
      manualOverride: null,
      source: "automatic",
    }];
    const user = userEvent.setup();
    render(<EntryScreen />);
    const card = getShiftDayCard();
    await user.click(card.querySelector(".day-row-toggle") as HTMLButtonElement);

    expect(within(card).getByText("Automatic")).toBeTruthy();
    expect(within(card).getByText(/Calculated once per worked location.*\$12\.50/i)).toBeTruthy();
    const editAmount = within(card).getByRole("button", { name: /current value \$12\.50/i });
    await user.click(editAmount);
    expect(await screen.findByRole("dialog", { name: /Fuel allowance — Wed Jan 7/i })).toBeTruthy();
  });

  it("provides a direct Work & pay settings action when no locations exist", async () => {
    fakeLocations = [];
    const onManageLocations = vi.fn();
    const user = userEvent.setup();
    render(<EntryScreen onManageLocations={onManageLocations} />);

    await user.click(screen.getByRole("button", { name: /Today's work location: Add a work location/i }));
    const picker = await screen.findByRole("dialog", { name: /Choose today's work location/i });
    expect(within(picker).getByText("No work locations yet")).toBeTruthy();
    await user.click(within(picker).getByRole("button", { name: /Manage work locations/i }));
    await waitFor(() => expect(onManageLocations).toHaveBeenCalledOnce());
  });
});
