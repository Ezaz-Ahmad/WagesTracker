// @vitest-environment jsdom
//
// The authenticated shell must not mount until the visual viewport has
// settled — that ordering is the actual fix for the installed-iPhone-PWA
// bug, and it's easy to lose in a later refactor (an un-awaited call, or a
// call added to login but forgotten on signup). These tests pin the
// ordering itself: status stays "loggedOut" while the settle step is
// outstanding, for both entry points.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppProvider, useApp } from "../AppContext";

const { settleSpy } = vi.hoisted(() => ({ settleSpy: vi.fn<() => Promise<void>>() }));

vi.mock("../../lib/viewportHeight", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/viewportHeight")>();
  return { ...actual, settleViewportBeforeAuth: settleSpy };
});

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getToken: vi.fn(() => null),
    setToken: vi.fn(),
    clearToken: vi.fn(),
    recordActivity: vi.fn(),
    getLastActivity: vi.fn(() => null),
    clearLastActivity: vi.fn(),
    setRememberedEmail: vi.fn(),
    clearRememberedEmail: vi.fn(),
    login: vi.fn(),
    signup: vi.fn(),
    fetchMe: vi.fn(),
    logout: vi.fn(async () => {}),
    listShifts: vi.fn(async () => ({ shifts: [] })),
    listDayExpenses: vi.fn(async () => ({ expenses: [] })),
    listWeekExtras: vi.fn(async () => ({ extras: [] })),
  };
});

import * as api from "../../lib/api";

const apiLogin = api.login as unknown as ReturnType<typeof vi.fn>;
const apiSignup = api.signup as unknown as ReturnType<typeof vi.fn>;

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

const SIGNUP_INPUT = {
  name: USER.name,
  email: USER.email,
  password: "correct horse battery staple",
  address: "",
  workLocationName: "",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  rate: 20,
};

/** Exposes just enough of the context to drive and observe the transition. */
function Harness() {
  const { status, login, signup } = useApp();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <button type="button" onClick={() => void login(USER.email, "pw")}>
        login
      </button>
      <button type="button" onClick={() => void signup(SIGNUP_INPUT)}>
        signup
      </button>
    </div>
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function status(): string {
  return screen.getByTestId("status").textContent ?? "";
}

beforeEach(() => {
  settleSpy.mockReset();
  apiLogin.mockReset();
  apiSignup.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("auth transitions wait for the settled viewport", () => {
  it("does not show the authenticated shell until the viewport settle step finishes (login)", async () => {
    const gate = deferred();
    settleSpy.mockReturnValue(gate.promise);
    apiLogin.mockResolvedValue({ token: "t", user: USER });

    render(
      <AppProvider>
        <Harness />
      </AppProvider>
    );
    expect(status()).toBe("loggedOut");

    await act(async () => {
      screen.getByText("login").click();
    });

    // Credentials are already accepted at this point — the only thing still
    // holding the shell back is the viewport.
    expect(settleSpy).toHaveBeenCalledTimes(1);
    expect(status()).toBe("loggedOut");

    await act(async () => {
      gate.resolve();
    });
    expect(status()).toBe("loggedIn");
  });

  it("gives signup exactly the same protection as login", async () => {
    const gate = deferred();
    settleSpy.mockReturnValue(gate.promise);
    apiSignup.mockResolvedValue({ token: "t", user: USER });

    render(
      <AppProvider>
        <Harness />
      </AppProvider>
    );

    await act(async () => {
      screen.getByText("signup").click();
    });
    expect(settleSpy).toHaveBeenCalledTimes(1);
    expect(status()).toBe("loggedOut");

    await act(async () => {
      gate.resolve();
    });
    expect(status()).toBe("loggedIn");
  });

  it("never runs the settle step when the credentials were rejected", async () => {
    apiLogin.mockRejectedValue(new Error("Invalid email or password"));

    render(
      <AppProvider>
        <Harness />
      </AppProvider>
    );
    await act(async () => {
      screen.getByText("login").click();
    });

    expect(settleSpy).not.toHaveBeenCalled();
    expect(status()).toBe("loggedOut");
  });

  it("goes straight through when the settle step has nothing to wait for", async () => {
    settleSpy.mockResolvedValue(undefined);
    apiLogin.mockResolvedValue({ token: "t", user: USER });

    render(
      <AppProvider>
        <Harness />
      </AppProvider>
    );
    await act(async () => {
      screen.getByText("login").click();
    });
    expect(status()).toBe("loggedIn");
  });
});
