// @vitest-environment jsdom
//
// End-to-end coverage of the welcome screen's actual placement in the real
// login flow (see App.tsx's Root + WelcomeScreen.tsx), driven through the
// real <App /> the same way deviceLimitNotice.test.tsx exercises the
// device-limit notice — a value that's computed but never actually shown at
// the right moment is exactly the failure class a component-only test can't
// catch.
//
// What's asserted here is the placement/lifecycle contract only — "shows
// before AuthScreen on a cold logged-out launch," "Get started reveals the
// login form," "reappears after every logout, not just the first launch."
// WelcomeScreen's own content and its accessible dismiss button are covered
// directly in screens/__tests__/WelcomeScreen.test.tsx.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getToken: vi.fn(() => null),
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
    logout: vi.fn(async () => {}),
    listSessions: vi.fn(async () => ({ sessions: [] })),
    listShifts: vi.fn(async () => ({ shifts: [] })),
    listDayExpenses: vi.fn(async () => ({ expenses: [] })),
    listWeekExtras: vi.fn(async () => ({ extras: [] })),
  };
});

import * as api from "../../lib/api";
import App from "../../App";

const apiLogin = api.login as unknown as ReturnType<typeof vi.fn>;

const USER = {
  id: "u1",
  name: "Sam Lee",
  email: "sam@example.com",
  address: "",
  workLocationName: "",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: 1,
  rate: 20,
  goalHours: 40,
  goalEarnings: 800,
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  (api.getToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
});

afterEach(cleanup);

describe("welcome screen placement in the real login flow", () => {
  it("shows before the login form on a cold, logged-out launch", async () => {
    render(<App />);

    const getStarted = await screen.findByRole("button", { name: "Get started" });
    expect(getStarted).toBeTruthy();
    // The login form itself isn't reachable yet — it's genuinely behind
    // this screen, not just also present somewhere in the DOM.
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("reveals the login form once Get started is tapped", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Get started" }));

    expect(await screen.findByLabelText("Email")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Get started" })).toBeNull();
  });

  it("does not come back on its own while simply switching between login and create-account modes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Get started" }));
    await screen.findByLabelText("Email");

    await user.click(screen.getByRole("radio", { name: "Create account" }));
    expect(screen.queryByRole("button", { name: "Get started" })).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Log in" }));
    expect(screen.queryByRole("button", { name: "Get started" })).toBeNull();
  });

  it("reappears after logging out — not just on the very first launch", async () => {
    apiLogin.mockResolvedValue({ token: "ordinary-token", user: USER });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Get started" }));
    await user.type(await screen.findByLabelText("Email"), USER.email);
    await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByRole("navigation", { name: "Main" });

    await user.click(screen.getByRole("button", { name: "Log out" }));
    const popup = await screen.findByRole("alertdialog");
    await user.click(within(popup).getByRole("button", { name: /^(log out|yes|confirm)/i }));

    // Back to "loggedOut" — the welcome screen is shown again, exactly as
    // it was on the very first cold launch, not skipped this time around.
    await waitFor(() => expect(screen.getByRole("button", { name: "Get started" })).toBeTruthy());
    expect(screen.queryByLabelText("Email")).toBeNull();
  });

  it("never appears once actually logged in", async () => {
    apiLogin.mockResolvedValue({ token: "ordinary-token", user: USER });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Get started" }));
    await user.type(await screen.findByLabelText("Email"), USER.email);
    await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    await screen.findByRole("navigation", { name: "Main" });
    expect(screen.queryByRole("button", { name: "Get started" })).toBeNull();
  });
});
