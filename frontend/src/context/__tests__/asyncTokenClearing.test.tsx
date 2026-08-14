// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
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
    logout: vi.fn(async () => {}),
    deleteAccount: vi.fn(async () => {}),
    listSessions: vi.fn(async () => ({ sessions: [] })),
    listShifts: vi.fn(async () => ({ shifts: [] })),
    listDayExpenses: vi.fn(async () => ({ expenses: [] })),
    listWeekExtras: vi.fn(async () => ({ extras: [] })),
  };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { AppProvider, useApp } from "../AppContext";

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

let logoutFromApp: () => Promise<void>;
let deleteAccountFromApp: (password: string) => Promise<void>;

function Harness() {
  const app = useApp();
  logoutFromApp = app.logout;
  deleteAccountFromApp = app.deleteAccount;
  return <div data-testid="status">{app.status}</div>;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function renderProvider() {
  render(
    <AppProvider>
      <Harness />
    </AppProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue("existing-token");
  (api.getLastActivity as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Date.now());
  (api.fetchMe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: USER });
  (api.clearToken as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

afterEach(cleanup);

describe("asynchronous token clearing", () => {
  it("awaits secure storage during manual logout", async () => {
    const clear = deferred();
    (api.clearToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue(clear.promise);
    renderProvider();
    await screen.findByText("loggedIn");

    let logoutPromise!: Promise<void>;
    act(() => { logoutPromise = logoutFromApp(); });
    expect(api.clearToken).toHaveBeenCalledOnce();
    expect(screen.getByTestId("status").textContent).toBe("loggedIn");

    clear.resolve();
    await act(async () => { await logoutPromise; });
    expect(screen.getByTestId("status").textContent).toBe("loggedOut");
  });

  it("handles a secure-storage cleanup failure without an unhandled logout rejection", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    (api.clearToken as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Keychain unavailable"));
    renderProvider();
    await screen.findByText("loggedIn");

    await act(async () => { await logoutFromApp(); });

    expect(screen.getByTestId("status").textContent).toBe("loggedOut");
    expect(consoleError).toHaveBeenCalledWith(
      "Could not clear the stored authentication token",
      expect.any(Error)
    );
    consoleError.mockRestore();
  });

  it("awaits secure storage after account deletion", async () => {
    const clear = deferred();
    (api.clearToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue(clear.promise);
    renderProvider();
    await screen.findByText("loggedIn");

    let deletion!: Promise<void>;
    act(() => { deletion = deleteAccountFromApp("correct password"); });
    expect(api.deleteAccount).toHaveBeenCalled();
    expect(screen.getByTestId("status").textContent).toBe("loggedIn");

    clear.resolve();
    await act(async () => { await deletion; });
    expect(screen.getByTestId("status").textContent).toBe("loggedOut");
  });

  it("awaits secure storage when a persisted session has idled out", async () => {
    const clear = deferred();
    (api.getLastActivity as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Date.now() - 11 * 60 * 1000);
    (api.clearToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue(clear.promise);
    renderProvider();

    expect(screen.getByTestId("status").textContent).toBe("loading");
    expect(api.fetchMe).not.toHaveBeenCalled();
    clear.resolve();
    await screen.findByText("loggedOut");
    expect(api.clearLastActivity).toHaveBeenCalled();
  });

  it("awaits secure storage after an authentication failure", async () => {
    const clear = deferred();
    (api.fetchMe as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new ApiError("Expired", 401));
    (api.clearToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue(clear.promise);
    renderProvider();

    await act(async () => {});
    expect(api.clearToken).toHaveBeenCalledOnce();
    expect(screen.getByTestId("status").textContent).toBe("loading");
    clear.resolve();
    await screen.findByText("loggedOut");
  });
});
