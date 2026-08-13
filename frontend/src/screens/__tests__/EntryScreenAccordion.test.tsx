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
import type { Shift, User } from "../../lib/types";
import { isoDate } from "../../lib/date";
import { EntryScreen } from "../EntryScreen";
import { ConfirmProvider } from "../../components/ConfirmProvider";

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

function useFakeApp(): AppCtx {
  return {
    today,
    user: testUser,
    shifts: [testShift],
    shiftsLoaded: true,
    createShift: vi.fn().mockResolvedValue(undefined),
    updateShift,
    removeShift,
    dayExpenses: [],
    setFuelCost: vi.fn().mockResolvedValue(undefined),
    weekExtras: [],
    setWeekExtra: vi.fn().mockResolvedValue(true),
    earningsHidden: false,
    revealEarnings: vi.fn(),
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

beforeEach(() => {
  removeShift = vi.fn().mockResolvedValue(undefined);
  updateShift = vi.fn().mockResolvedValue(undefined);
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
  it("asks before saving an unusually long manual shift and cancellation does not update it", async () => {
    const user = userEvent.setup();
    render(<ConfirmProvider><EntryScreen /></ConfirmProvider>);
    const card = getShiftDayCard();
    await user.click(card.querySelector(".day-row-toggle") as HTMLButtonElement);

    const signOut = within(card).getByLabelText("Sign-out time") as HTMLInputElement;
    fireEvent.change(signOut, { target: { value: "01:30" } });
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/unusually long/i);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(updateShift).not.toHaveBeenCalled();
    expect(signOut.value).toBe("17:00");

    fireEvent.change(signOut, { target: { value: "01:30" } });
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(updateShift).toHaveBeenCalledWith("shift-1", { signOut: "01:30" }));
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
});
