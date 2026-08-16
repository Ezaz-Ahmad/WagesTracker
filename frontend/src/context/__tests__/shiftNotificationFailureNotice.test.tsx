// @vitest-environment jsdom
//
// The shift-notification failure banner, end to end and at the context
// plumbing level.
//
// postShiftStartedNotification never throws (see NativeShiftNotificationAdapter
// and useTodayShift.start()) — a platform failure (permission denied, a
// Keychain write error, etc.) used to be swallowed into a console.error only,
// completely invisible to the person relying on the reminder to sign out.
// This covers the fix: the adapter's result is inspected once it settles and,
// on ok: false, surfaced through a dedicated shiftNotificationNotice banner —
// distinct from actionError (danger tone) because the shift itself already
// started successfully; only the reminder didn't show up.
//
// Mirrors deviceLimitNotice.test.tsx's own reasoning for going through the
// real <App/> rather than only asserting context state: a value that's
// computed but never rendered is exactly the failure class that bug was.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getToken: vi.fn(() => "session-token"),
    setToken: vi.fn(),
    clearToken: vi.fn(),
    isRemembered: vi.fn(() => true),
    recordActivity: vi.fn(),
    getLastActivity: vi.fn(() => null),
    clearLastActivity: vi.fn(),
    getRememberedEmail: vi.fn(() => null),
    setRememberedEmail: vi.fn(),
    clearRememberedEmail: vi.fn(),
    login: vi.fn(),
    signup: vi.fn(),
    fetchMe: vi.fn(),
    fetchMeWithToken: vi.fn(),
    logout: vi.fn(async () => {}),
    listSessions: vi.fn(async () => ({ sessions: [] })),
    listShifts: vi.fn(async () => ({ shifts: [] })),
    listDayExpenses: vi.fn(async () => ({ expenses: [] })),
    listWeekExtras: vi.fn(async () => ({ extras: [] })),
    createShift: vi.fn(),
    getApiOrigin: vi.fn(() => "https://wage-tracker-api.example.com"),
  };
});

const postShiftStartedNotification = vi.fn();
vi.mock("../../platform/shiftNotifications", () => ({
  postShiftStartedNotification: (...args: unknown[]) => postShiftStartedNotification(...args),
  clearShiftNotification: vi.fn().mockResolvedValue(undefined),
  getPendingEndShift: vi.fn().mockResolvedValue(null),
  clearPendingEndShift: vi.fn().mockResolvedValue(undefined),
  isShiftNotificationEnabled: () => true,
  setShiftNotificationEnabled: vi.fn(),
  // The real default is `false` (the whole feature is temporarily paused —
  // see isShiftNotificationFeatureEnabled's doc comment in
  // platform/shiftNotifications.ts), but this file specifically exercises
  // the still-fully-implemented posting/failure-notice wiring end to end,
  // so it's forced on here, same as isShiftNotificationEnabled above.
  isShiftNotificationFeatureEnabled: () => true,
}));

import * as api from "../../lib/api";
import App from "../../App";

const apiLogin = api.login as unknown as ReturnType<typeof vi.fn>;
const apiCreateShift = api.createShift as unknown as ReturnType<typeof vi.fn>;

const USER = {
  id: "u1",
  name: "Sam Lee",
  email: "sam@example.com",
  address: "",
  workLocationName: "Downtown Store",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: 1,
  rate: 20,
  goalHours: 40,
  goalEarnings: 800,
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

async function logIn(user: ReturnType<typeof userEvent.setup>) {
  apiLogin.mockResolvedValue({ token: "ordinary-token", user: USER });
  render(<App />);
  // The mobile welcome screen (see WelcomeScreen.tsx) now appears before
  // every login, in front of AuthScreen — dismissed here via its
  // always-present "Get started" button so the rest of this helper can
  // reach the login form exactly as it did before that screen existed.
  await user.click(await screen.findByRole("button", { name: "Get started" }));
  await user.type(await screen.findByLabelText("Email"), USER.email);
  await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
  await user.click(screen.getByRole("button", { name: "Log in" }));
  await screen.findByRole("navigation", { name: "Main" });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiCreateShift.mockResolvedValue({
    shift: { id: "new-shift-1", date: "2026-08-16", location: "Downtown Store", signIn: "09:00:00", signOut: null },
  });
});

afterEach(cleanup);

describe("shift-notification failure banner", () => {
  it("appears, in a warning (not danger) tone, when the platform adapter reports ok: false", async () => {
    postShiftStartedNotification.mockResolvedValue({
      ok: false,
      error: "Could not save the shift notification credential.",
    });
    const user = userEvent.setup();
    await logIn(user);

    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    const banner = await screen.findByText(/reminder notification couldn't be shown/i);
    const region = banner.closest("[role]")!;
    expect(region.getAttribute("role")).toBe("status");
    expect(region.className).toContain("banner-warning");
    expect(region.className).not.toContain("banner-danger");
    expect(banner.textContent).toContain("Could not save the shift notification credential.");
  });

  it("never appears when the platform adapter reports ok: true", async () => {
    postShiftStartedNotification.mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    await logIn(user);

    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    await waitFor(() => expect(postShiftStartedNotification).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/reminder notification couldn't be shown/i)).toBeNull();
  });

  it("is dismissable, like the app's other banners", async () => {
    postShiftStartedNotification.mockResolvedValue({ ok: false, error: "Notifications are turned off." });
    const user = userEvent.setup();
    await logIn(user);

    await user.click(screen.getByRole("button", { name: /^sign in$/i }));
    const banner = await screen.findByText(/reminder notification couldn't be shown/i);
    const region = banner.closest(".banner") as HTMLElement;

    await user.click(within(region).getByRole("button", { name: "Dismiss this notice" }));
    await waitFor(() => expect(screen.queryByText(/reminder notification couldn't be shown/i)).toBeNull());
  });
});
