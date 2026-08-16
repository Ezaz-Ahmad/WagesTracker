// @vitest-environment jsdom
//
// Regression tests for the shift-in-progress notification wiring added to
// useTodayShift: start() must post the notification with the exact payload
// the native side needs to finish a background "Sign out" tap on its own
// (see shiftNotifications.ts/ShiftNotificationPlugin.swift), and end() must
// clear it — but only once the PATCH the button represents actually
// succeeded, never before, and never as a hard dependency (a notification
// failure must not make start()/end() themselves look like they failed).
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import type { Shift, User } from "../../lib/types";
import { ShiftButton } from "../../components/ShiftButton";
import { useTodayShift } from "../useTodayShift";

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

let today: Date;
let shifts: Shift[];
let createShift: ReturnType<typeof vi.fn>;
let updateShift: ReturnType<typeof vi.fn>;

function useFakeApp(): AppCtx {
  return { today, shifts, user: testUser, createShift, updateShift } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

const postShiftStartedNotification = vi.fn().mockResolvedValue(undefined);
const clearShiftNotification = vi.fn().mockResolvedValue(undefined);
vi.mock("../../platform/shiftNotifications", () => ({
  postShiftStartedNotification: (...args: unknown[]) => postShiftStartedNotification(...args),
  clearShiftNotification: (...args: unknown[]) => clearShiftNotification(...args),
}));

let tokenValue: string | null;
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    getToken: () => tokenValue,
    getApiOrigin: () => "https://wage-tracker-api.example.com",
  };
});

function Harness() {
  const { active, start, end } = useTodayShift();
  return <ShiftButton active={active} onStart={start} onEnd={end} busy={false} />;
}

beforeEach(() => {
  today = new Date("2026-08-09T09:00:00");
  shifts = [];
  createShift = vi.fn();
  updateShift = vi.fn();
  tokenValue = "session-token";
  postShiftStartedNotification.mockClear();
  clearShiftNotification.mockClear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-08-09T09:00:00"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useTodayShift → shift-notification wiring on start()", () => {
  it("posts the notification with the new shift's id, current token, API origin, and a formatted start label", async () => {
    const user = userEvent.setup();
    createShift.mockResolvedValue({ id: "new-shift-1", date: "2026-08-09", location: "Downtown Store", signIn: "09:00:00", signOut: null });
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(postShiftStartedNotification).toHaveBeenCalledTimes(1));
    expect(postShiftStartedNotification).toHaveBeenCalledWith({
      shiftId: "new-shift-1",
      apiBaseUrl: "https://wage-tracker-api.example.com",
      token: "session-token",
      startedAtLabel: "Started at 9:00 AM",
    });
  });

  it("does not post a notification when createShift fails (returns undefined)", async () => {
    const user = userEvent.setup();
    createShift.mockResolvedValue(undefined);
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(createShift).toHaveBeenCalledTimes(1));
    expect(postShiftStartedNotification).not.toHaveBeenCalled();
  });

  it("does not post a notification when there is no session token to hand the native layer", async () => {
    const user = userEvent.setup();
    tokenValue = null;
    createShift.mockResolvedValue({ id: "new-shift-1", date: "2026-08-09", location: "Downtown Store", signIn: "09:00:00", signOut: null });
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(createShift).toHaveBeenCalledTimes(1));
    expect(postShiftStartedNotification).not.toHaveBeenCalled();
  });

  it("a rejected postShiftStartedNotification never surfaces as an unhandled rejection or blocks the button", async () => {
    // NativeShiftNotificationAdapter itself never throws (see its own
    // tests), but start() awaits nothing here — this proves the fire-and-
    // forget call is genuinely fire-and-forget even in the pathological
    // case of a broken/misbehaving adapter implementation.
    const user = userEvent.setup();
    postShiftStartedNotification.mockRejectedValueOnce(new Error("boom"));
    createShift.mockResolvedValue({ id: "new-shift-1", date: "2026-08-09", location: "Downtown Store", signIn: "09:00:00", signOut: null });
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    // The assertion is simply that this resolves at all — a broken adapter
    // rejecting must not turn into an unhandled promise rejection or stop
    // start() from completing; createShift having been reached confirms the
    // click was actually processed rather than the test passing vacuously.
    await waitFor(() => expect(createShift).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(postShiftStartedNotification).toHaveBeenCalledTimes(1));
  });
});

describe("useTodayShift → shift-notification wiring on end()", () => {
  it("clears the notification once the sign-out PATCH succeeds", async () => {
    const user = userEvent.setup();
    shifts = [{ id: "open-1", date: "2026-08-09", location: "Downtown Store", signIn: "08:00:00", signOut: null }];
    updateShift.mockResolvedValue({ id: "open-1", date: "2026-08-09", location: "Downtown Store", signIn: "08:00:00", signOut: "09:00:00" });
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(updateShift).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(clearShiftNotification).toHaveBeenCalledTimes(1));
  });

  it("does not clear the notification when the sign-out PATCH fails (returns undefined)", async () => {
    const user = userEvent.setup();
    shifts = [{ id: "open-1", date: "2026-08-09", location: "Downtown Store", signIn: "08:00:00", signOut: null }];
    updateShift.mockResolvedValue(undefined);
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(updateShift).toHaveBeenCalledTimes(1));
    expect(clearShiftNotification).not.toHaveBeenCalled();
  });
});
