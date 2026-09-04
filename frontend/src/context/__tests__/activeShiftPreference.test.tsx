// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getToken: vi.fn(() => "existing-token"),
    setToken: vi.fn(async () => {}),
    clearToken: vi.fn(async () => {}),
    isRemembered: vi.fn(() => true),
    recordActivity: vi.fn(),
    getLastActivity: vi.fn(() => Date.now()),
    clearLastActivity: vi.fn(),
    getRememberedEmail: vi.fn(() => null),
    setRememberedEmail: vi.fn(),
    clearRememberedEmail: vi.fn(),
    fetchMe: vi.fn(),
    listSessions: vi.fn(async () => ({ sessions: [] })),
    listShifts: vi.fn(),
    listDayExpenses: vi.fn(async () => ({ expenses: [] })),
    listWeekExtras: vi.fn(async () => ({ extras: [] })),
    listWorkLocations: vi.fn(async () => ({ locations: [] })),
    issueShiftClockOutToken: vi.fn(async () => ({ clockOutToken: "one-shift-token" })),
  };
});

import * as api from "../../lib/api";
import {
  configureActiveShiftActivity,
  resetActiveShiftActivityForTests,
  type ActiveShiftActivityInfo,
  type ActiveShiftActivityStartResult,
} from "../../platform/activeShiftActivity";
import { AppProvider, useApp } from "../AppContext";

const USER = {
  id: "active-pref-user",
  name: "Test User",
  email: "test@example.com",
  address: "",
  workLocationName: "Newcastle",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Monday",
  rate: 30,
  goalHours: 38,
  goalEarnings: 1140,
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

let changePreference: (enabled: boolean) => Promise<void>;
function startMock() {
  return vi.fn(async (_info: ActiveShiftActivityInfo): Promise<ActiveShiftActivityStartResult> => ({
    status: "active",
    pendingClockOut: false,
    completionNotifications: "authorized",
  }));
}
function dismissMock() {
  return vi.fn(async (): Promise<void> => {});
}
let startOrUpdate = startMock();
let dismiss = dismissMock();

function Harness() {
  const app = useApp();
  changePreference = app.setActiveShiftActivityEnabled;
  return <div>{app.status}:{String(app.shiftsLoaded)}:{String(app.activeShiftActivityEnabled)}</div>;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  (api.fetchMe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: USER });
  (api.listShifts as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    shifts: [{ id: "open-shift", date: "2026-08-30", location: "Newcastle", signIn: "09:00:00", signOut: null }],
  });
  startOrUpdate = startMock();
  dismiss = dismissMock();
  configureActiveShiftActivity({
    startOrUpdate,
    dismiss,
    end: vi.fn().mockResolvedValue(undefined),
    retryPendingClockOut: vi.fn().mockResolvedValue({ queued: false }),
    subscribeEnded: vi.fn().mockResolvedValue(() => {}),
  });
});

afterEach(() => {
  cleanup();
  resetActiveShiftActivityForTests();
  localStorage.clear();
});

describe("AppProvider active-shift opt-in", () => {
  it("does not start the Live Activity until enabled, then removes only the surface when disabled", async () => {
    render(<AppProvider><Harness /></AppProvider>);
    await screen.findByText("loggedIn:true:false");
    await waitFor(() => expect(dismiss).toHaveBeenCalled());
    expect(startOrUpdate).not.toHaveBeenCalled();

    await act(async () => { await changePreference(true); });
    await screen.findByText("loggedIn:true:true");
    await waitFor(() => expect(startOrUpdate).toHaveBeenCalledWith(expect.objectContaining({
      shiftId: "open-shift",
      appearance: "system",
    })));

    dismiss.mockClear();
    await act(async () => { await changePreference(false); });
    await screen.findByText("loggedIn:true:false");
    expect(dismiss).toHaveBeenCalled();
    expect(localStorage.getItem("wagesTracker.activeShiftActivity.enabled.v1:active-pref-user")).toBe("off");
  });
});
