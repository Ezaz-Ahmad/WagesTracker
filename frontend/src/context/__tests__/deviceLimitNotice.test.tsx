// @vitest-environment jsdom
//
// The device-limit notice, end to end: HTTP response → api client → context
// → a visible, announced banner in the authenticated shell.
//
// This existed on the server and nowhere else. `POST /auth/login` has
// returned `notice` ever since per-installation sessions landed, and
// api.login's return type declared it — but AppContext's login destructured
// only `{ token, user }`, so the field was read off the response and thrown
// away one line later. The one thing it exists to explain ("your least
// recently used device was signed out because you hit the device limit")
// was never said to anyone.
//
// The whole path is exercised through the real <App />: a real login form
// submission, the real provider, the real shell. A test that only asserted
// "context.sessionNotice is set" would have passed against a build where the
// banner was never rendered, which is precisely the failure being fixed.
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
  weekStartsOn: "Monday",
  rate: 20,
  goalHours: 40,
  goalEarnings: 800,
  createdAt: "2026-01-01T00:00:00.000Z",
} as const;

/** The exact sentence the backend builds (routes/auth.ts) when the device
 * limit evicts a session. Reproduced verbatim rather than paraphrased, so
 * this test also pins the two properties the wording has to have: it says
 * *why* a device was signed out, and it names no session identifier. */
const NOTICE = "You were signed in on more than 5 devices, so the least recently used one was signed out.";

async function logIn(user: ReturnType<typeof userEvent.setup>) {
  // The mobile welcome screen (see WelcomeScreen.tsx) now appears before
  // every login, in front of AuthScreen — dismissed here via its
  // always-present "Get started" button so the rest of this helper can
  // reach the login form exactly as it did before that screen existed.
  await user.click(await screen.findByRole("button", { name: "Get started" }));
  await user.type(await screen.findByLabelText("Email"), USER.email);
  await user.type(screen.getByLabelText("Password"), "correct horse battery staple");
  await user.click(screen.getByRole("button", { name: "Log in" }));
  // The shell is up once the main navigation exists.
  await screen.findByRole("navigation", { name: "Main" });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);
});

afterEach(cleanup);

describe("device-limit notice", () => {
  it("reaches the screen as an announced, non-error notice after a successful login", async () => {
    apiLogin.mockResolvedValue({ token: "t", user: USER, notice: NOTICE });
    const user = userEvent.setup();
    render(<App />);
    await logIn(user);

    const banner = await screen.findByText(NOTICE);
    const region = banner.closest("[role]")!;

    // role="status", not role="alert": this login *succeeded*. An alert
    // would interrupt whatever a screen-reader user is listening to and
    // frame a successful sign-in as a failure.
    expect(region.getAttribute("role")).toBe("status");
    // And it must not be dressed as an error either.
    expect(region.className).toContain("banner-info");
    expect(region.className).not.toContain("banner-danger");
  });

  it("says nothing at all on an ordinary login", async () => {
    apiLogin.mockResolvedValue({ token: "t", user: USER });
    const user = userEvent.setup();
    render(<App />);
    await logIn(user);

    expect(screen.queryByText(/least recently used/i)).toBeNull();
    expect(document.querySelector(".banner-info")).toBeNull();
  });

  it("never names a session identifier", async () => {
    apiLogin.mockResolvedValue({ token: "t", user: USER, notice: NOTICE });
    const user = userEvent.setup();
    render(<App />);
    await logIn(user);

    const text = (await screen.findByText(NOTICE)).textContent ?? "";
    expect(text).not.toMatch(/session[-_ ]?id/i);
    // No bare UUID/opaque-id-looking token anywhere in the sentence.
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
  });

  it("stays dismissed — navigating away and back does not bring it back", async () => {
    apiLogin.mockResolvedValue({ token: "t", user: USER, notice: NOTICE });
    const user = userEvent.setup();
    render(<App />);
    await logIn(user);

    const region = (await screen.findByText(NOTICE)).closest(".banner")!;
    await user.click(within(region as HTMLElement).getByRole("button", { name: "Dismiss this notice" }));
    await waitFor(() => expect(screen.queryByText(NOTICE)).toBeNull());

    // A tab change re-renders the shell; the notice must not come back with
    // it. (It lives in provider state and is set only by a login response,
    // which is what makes this hold.)
    const nav = screen.getByRole("navigation", { name: "Main" });
    await user.click(within(nav).getByRole("button", { name: "Settings" }));
    await user.click(within(nav).getByRole("button", { name: "Home" }));
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it("survives a tab change if it has not been dismissed", async () => {
    // The mirror of the case above: "shown once" must not degrade into
    // "shown for one render and then silently gone before it can be read".
    apiLogin.mockResolvedValue({ token: "t", user: USER, notice: NOTICE });
    const user = userEvent.setup();
    render(<App />);
    await logIn(user);
    await screen.findByText(NOTICE);

    const nav = screen.getByRole("navigation", { name: "Main" });
    await user.click(within(nav).getByRole("button", { name: "History" }));
    expect(screen.getByText(NOTICE)).toBeTruthy();
  });

  it("is dismissable from the keyboard, not only by pointer", async () => {
    apiLogin.mockResolvedValue({ token: "t", user: USER, notice: NOTICE });
    const user = userEvent.setup();
    render(<App />);
    await logIn(user);

    const region = (await screen.findByText(NOTICE)).closest(".banner")!;
    const dismiss = within(region as HTMLElement).getByRole("button", { name: "Dismiss this notice" });
    dismiss.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByText(NOTICE)).toBeNull());
  });
});
