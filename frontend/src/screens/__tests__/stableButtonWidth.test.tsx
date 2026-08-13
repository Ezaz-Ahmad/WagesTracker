// @vitest-environment jsdom
//
// Buttons must not resize as their state changes.
//
// jsdom performs no layout, so a literal width measurement is worthless
// here. What can be pinned is the structural property the stable-width
// technique depends on, which is also the thing a later edit would
// accidentally remove: the label variant that is *not* currently showing has
// to stay in the document contributing its box, rather than being swapped
// out for the shorter one. `visibility: hidden` keeps a box; conditional
// rendering does not, and the difference is invisible in a code review.
//
// The PDF download button is the case that motivated this. It had three
// states with three different natural widths — "Download PDF", a spinner,
// and "Downloaded ✓" — so every download resized it twice and shoved the
// "Progress report" heading beside it sideways each time.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import type { Shift, User } from "../../lib/types";

type AppCtx = ReturnType<typeof useApp>;

const USER: User = {
  id: "user-1",
  name: "Test User",
  email: "test@example.com",
  address: "",
  workLocationName: "",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Monday",
  rate: 20,
  goalHours: 35,
  goalEarnings: 700,
  createdAt: "2025-01-01T00:00:00.000Z",
};

const SHIFTS: Shift[] = [
  { id: "s1", date: "2026-02-02", signIn: "09:00", signOut: "17:00", location: "Store" },
];

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return {
    ...actual,
    useApp: () =>
      ({
        user: USER,
        today: new Date("2026-02-04T10:00:00.000Z"),
        shifts: SHIFTS,
        shiftsLoaded: true,
        dayExpenses: [],
        weekExtras: [],
        earningsHidden: false,
      }) as unknown as AppCtx,
  };
});

/** Holds the PDF generation open so the in-flight state can be inspected,
 * rather than racing a promise that resolves in the same tick. */
let releasePdf: () => void = () => {};

vi.mock("../../pdf/generateReportPdf", () => ({
  generateReportPdf: vi.fn(
    () =>
      new Promise<void>((resolve) => {
        releasePdf = resolve;
      })
  ),
}));

const { ReportScreen } = await import("../ReportScreen");

afterEach(cleanup);

describe("PDF button width stability", () => {
  it("keeps the idle label in the document while the spinner shows", async () => {
    const user = userEvent.setup();
    render(<ReportScreen />);

    const button = screen.getByRole("button", { name: /Download PDF/ });
    const before = button.textContent;
    await user.click(button);

    await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));

    // The label is hidden, not removed — so it still holds the button's box
    // open at exactly the width it had a moment ago.
    const label = button.querySelector(".btn-stable-hidden");
    expect(label).not.toBeNull();
    expect(label!.textContent).toBe(before);

    // And the spinner is taken out of flow, so it adds no width of its own.
    expect(button.querySelector(".btn-stable-overlay")).not.toBeNull();

    releasePdf();
    await waitFor(() => expect(button.getAttribute("aria-busy")).toBeNull());
  });

  it("reserves the longest label's width in every settled state", async () => {
    const user = userEvent.setup();
    render(<ReportScreen />);
    const button = screen.getByRole("button", { name: /Download PDF/ });

    // Idle: the longer "Downloaded ✓" variant is already reserving space.
    const ghost = button.querySelector(".stable-label-ghost");
    expect(ghost?.textContent).toBe("Downloaded ✓");
    expect(ghost?.getAttribute("aria-hidden")).toBe("true");

    await user.click(button);
    releasePdf();

    // Settled success: same ghost, so the box does not change again on the
    // way back out of the loading state.
    await waitFor(() => expect(button.textContent).toContain("Downloaded ✓"));
    expect(button.querySelector(".stable-label-ghost")?.textContent).toBe("Downloaded ✓");
  });
});
