// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import { SmartReminderActionDialog } from "../SmartReminderActionDialog";

type AppCtx = ReturnType<typeof useApp>;

let fakeApp: Partial<AppCtx>;
vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => fakeApp as AppCtx };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("smart reminder notification actions", () => {
  it("never signs out from the notification tap and requires explicit in-app confirmation", async () => {
    const clockOutShift = vi.fn().mockResolvedValue({
      shift: { id: "open", date: "2026-09-07", location: "Central", signIn: "08:00", signOut: "17:24" },
      alreadyEnded: false,
      finalDurationSeconds: 33_840,
    });
    fakeApp = {
      pendingSmartReminderAction: {
        accountId: "u1", kind: "signOut", reminderId: "signout-open", shiftId: "open", usualTimeLabel: "5:00 PM",
      },
      dismissPendingSmartReminderAction: vi.fn(),
      today: new Date(2026, 8, 7, 17, 24),
      shifts: [{ id: "open", date: "2026-09-07", location: "Central", signIn: "08:00", signOut: null }],
      workLocations: [],
      createShift: vi.fn(),
      clockOutShift,
      user: { id: "u1" } as AppCtx["user"],
    };

    const user = userEvent.setup();
    render(<SmartReminderActionDialog onNavigate={vi.fn()} />);

    expect(clockOutShift).not.toHaveBeenCalled();
    expect(screen.getByText(/cannot happen until you confirm/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Confirm Sign Out" }));
    await waitFor(() => expect(clockOutShift).toHaveBeenCalledTimes(1));
  });

  it("requires a work location and a second tap before signing in", async () => {
    const createShift = vi.fn().mockResolvedValue({ id: "new-shift" });
    fakeApp = {
      pendingSmartReminderAction: {
        accountId: "u1", kind: "signIn", reminderId: "signin-2026-09-07", usualTimeLabel: "8:00 AM",
      },
      dismissPendingSmartReminderAction: vi.fn(),
      today: new Date(2026, 8, 7, 8, 22),
      shifts: [],
      workLocations: [{
        id: "central", name: "Central Store", address: "", fuelAllowance: null,
        archived: false, archivedAt: null, createdAt: "", updatedAt: "",
      }],
      createShift,
      clockOutShift: vi.fn(),
      user: { id: "u1" } as AppCtx["user"],
    };

    const user = userEvent.setup();
    render(<SmartReminderActionDialog onNavigate={vi.fn()} />);
    expect(createShift).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Confirm Sign In" }));
    await waitFor(() => expect(createShift).toHaveBeenCalledWith(expect.objectContaining({
      date: "2026-09-07", workLocationId: "central", signOut: null,
    })));
  });
});
