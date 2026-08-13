// @vitest-environment jsdom
//
// Regression tests for the midnight-rollover bug: useTodayShift used to
// find the active shift by filtering `shifts` down to `date === todayISO`
// first, so the instant the calendar date rolled over past midnight, an
// overnight shift that was signed in the day before simply stopped being
// found — the button flipped back to "Sign in," the timer stopped, and
// pressing it again would have started a *second* shift instead of ending
// the original one. The generic overnight-math tests (date.test.ts,
// aggregate.test.ts) don't catch this at all, since they never involve
// "today" changing while a shift is still open — this file renders the
// real hook plus the real ShiftButton/ElapsedTimer components, with `today`
// already past midnight relative to the open shift's date, which is
// exactly what happens on both a live day-rollover and a fresh reload.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import type { Shift, User } from "../../lib/types";
import { ElapsedTimer, ShiftButton } from "../../components/ShiftButton";
import { useTodayShift } from "../useTodayShift";
import { ConfirmProvider } from "../../components/ConfirmProvider";

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
  weekStartsOn: "Monday",
  rate: 20,
  goalHours: 35,
  goalEarnings: 700,
  createdAt: "2026-01-01T00:00:00.000Z",
};

// Signed in 10:00 AM on Aug 8; still open. `today` in the fake context
// below is set to just after midnight on Aug 9 — the exact "reload/rollover
// already happened" state, whether that's from the 60s day-rollover tick in
// AppContext or a fresh page load.
const openShift: Shift = { id: "shift-aug8", date: "2026-08-08", location: "Downtown Store", signIn: "10:00:00", signOut: null };

let today: Date;
let shifts: Shift[];
let createShift: ReturnType<typeof vi.fn>;
let updateShift: ReturnType<typeof vi.fn>;

function useFakeApp(): AppCtx {
  return {
    today,
    shifts,
    user: testUser,
    createShift,
    updateShift,
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

function Harness() {
  const { active, last, start, end } = useTodayShift();
  return (
    <div>
      <div data-testid="active">{String(active)}</div>
      <div data-testid="last-date">{last?.date ?? ""}</div>
      <div data-testid="last-id">{last?.id ?? ""}</div>
      <ShiftButton active={active} onStart={start} onEnd={end} busy={false} />
      <ElapsedTimer active={active} signIn={last?.signIn ?? null} />
      {/* Calls start() directly regardless of `active` — simulating a
          direct/forced call (a stale UI, a race) rather than the normal
          ShiftButton flow, which already can't reach onStart while active. */}
      <button type="button" onClick={start}>
        force-start
      </button>
    </div>
  );
}

beforeEach(() => {
  today = new Date("2026-08-09T01:30:00");
  shifts = [openShift];
  createShift = vi.fn().mockResolvedValue(undefined);
  updateShift = vi.fn().mockResolvedValue(undefined);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-09T01:30:00"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useTodayShift across a midnight rollover", () => {
  it("requires confirmation before clocking out a 16-hour-40-minute shift", async () => {
    const user = userEvent.setup();
    shifts = [{ ...openShift, signIn: "08:50:00" }];
    render(<ConfirmProvider><Harness /></ConfirmProvider>);

    await user.click(screen.getByRole("button", { name: /sign out/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toMatch(/unusually long/i);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(updateShift).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /sign out/i }));
    await user.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(updateShift).toHaveBeenCalledWith("shift-aug8", { signOut: "01:30:00" }));
  });
  it("keeps a shift signed in before midnight active after the date rolls over", () => {
    render(<Harness />);
    expect(screen.getByTestId("active").textContent).toBe("true");
    expect(screen.getByTestId("last-date").textContent).toBe("2026-08-08");
    expect(screen.getByTestId("last-id").textContent).toBe("shift-aug8");
  });

  it("still shows the Sign out button (not Sign in) after midnight", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: /sign out/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^sign in$/i })).toBeNull();
  });

  it("keeps the elapsed timer running (not frozen at 00:00:00) across midnight", () => {
    // 10:00:00 PM... no — 10:00:00 AM Aug 8 to 1:30:00 AM Aug 9 is 15h30m of
    // elapsed time. The old implementation built "start" from *today's*
    // date (Aug 9), landing in the future relative to "now" and producing a
    // negative duration that formatElapsed clamped to zero.
    render(<Harness />);
    const timer = document.querySelector(".elapsed-timer");
    expect(timer).toBeTruthy();
    expect(timer!.textContent).toBe("15:30:00");
  });

  it("PATCHes the original shift (by id, same date) when Sign out is pressed after midnight, without creating a new shift", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(updateShift).toHaveBeenCalledTimes(1));
    expect(updateShift).toHaveBeenCalledWith("shift-aug8", { signOut: "01:30:00" });
    // No `date` key at all in the patch — the shift's starting date is
    // never touched, let alone changed to today's date.
    const patch = updateShift.mock.calls[0][1];
    expect(patch).not.toHaveProperty("date");
    expect(createShift).not.toHaveBeenCalled();
  });

  it("never starts a second shift while one is already open, even if start() is invoked directly", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "force-start" }));

    expect(createShift).not.toHaveBeenCalled();
  });
});

describe("useTodayShift with no open shift", () => {
  it("shows Sign in and does not report anything active", () => {
    today = new Date("2026-08-09T01:30:00");
    shifts = [{ id: "closed", date: "2026-08-08", location: "", signIn: "09:00", signOut: "17:00" }];
    render(<Harness />);
    expect(screen.getByTestId("active").textContent).toBe("false");
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeTruthy();
  });
});
