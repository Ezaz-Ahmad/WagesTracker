// @vitest-environment jsdom
//
// Revoking the session backing this very device has to end in the login
// screen, immediately — not in an authenticated shell that keeps rendering
// until some later request happens to fail with a bare 401.
//
// The UI deliberately offers no "Log out" button on the current device's own
// card (SessionCard), so this path is reached when the *server* considers the
// revoked session to be the caller's: the same installation listed twice, a
// session rotated concurrently on another tab, or an id revoked from
// elsewhere between the list being fetched and the button being pressed. The
// backend reports that with `revokedCurrent`, and the client's job is to act
// on it rather than assume the common case.
//
// Tested at the context level because that is where the decision lives, and
// because the button that would drive it end-to-end intentionally doesn't
// exist.
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getToken: vi.fn(() => "existing-token"),
    setToken: vi.fn(),
    clearToken: vi.fn(),
    isRemembered: vi.fn(() => true),
    recordActivity: vi.fn(),
    getLastActivity: vi.fn(() => Date.now()),
    clearLastActivity: vi.fn(),
    getRememberedEmail: vi.fn(() => null),
    setRememberedEmail: vi.fn(),
    clearRememberedEmail: vi.fn(),
    fetchMe: vi.fn(),
    logout: vi.fn(async () => {}),
    revokeSession: vi.fn(),
    revokeOtherSessions: vi.fn(async () => {}),
    listSessions: vi.fn(async () => ({ sessions: [] })),
    listShifts: vi.fn(async () => ({ shifts: [] })),
    listDayExpenses: vi.fn(async () => ({ expenses: [] })),
    listWeekExtras: vi.fn(async () => ({ extras: [] })),
  };
});

import * as api from "../../lib/api";
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

let revoke: (id: string) => Promise<void>;

function Harness() {
  const { status, revokeSession } = useApp();
  revoke = revokeSession;
  return <div data-testid="status">{status}</div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.getToken as unknown as ReturnType<typeof vi.fn>).mockReturnValue("existing-token");
  (api.getLastActivity as unknown as ReturnType<typeof vi.fn>).mockReturnValue(Date.now());
  (api.fetchMe as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ user: USER });
});

afterEach(cleanup);

async function renderLoggedIn() {
  render(
    <AppProvider>
      <Harness />
    </AppProvider>
  );
  await screen.findByText("loggedIn");
}

describe("revoking the current session", () => {
  it("logs the app out immediately and clears the stored token", async () => {
    (api.revokeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ revokedCurrent: true });
    await renderLoggedIn();

    await act(async () => {
      await revoke("this-device");
    });

    expect(screen.getByTestId("status").textContent).toBe("loggedOut");
    expect(api.clearToken).toHaveBeenCalled();
    // Not left behind for the idle-timeout check to trip over on the next
    // launch and misreport this as an inactivity logout.
    expect(api.clearLastActivity).toHaveBeenCalled();
  });

  it("does not re-fetch the session list after logging itself out", async () => {
    // The list belongs to a session that no longer exists; asking for it can
    // only produce a 401 and a second, contradictory logout path.
    (api.revokeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ revokedCurrent: true });
    await renderLoggedIn();
    (api.listSessions as unknown as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await revoke("this-device");
    });

    expect(api.listSessions).not.toHaveBeenCalled();
  });

  it("stays signed in and refreshes the list when some other device was revoked", async () => {
    (api.revokeSession as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ revokedCurrent: false });
    await renderLoggedIn();
    (api.listSessions as unknown as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await revoke("some-other-device");
    });

    expect(screen.getByTestId("status").textContent).toBe("loggedIn");
    expect(api.clearToken).not.toHaveBeenCalled();
    expect(api.listSessions).toHaveBeenCalledTimes(1);
  });

  it("propagates a failed revoke instead of logging out on it", async () => {
    // A network failure must not be mistaken for "your session is gone" —
    // that would sign the user out over a dropped packet.
    (api.revokeSession as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Network unavailable"));
    await renderLoggedIn();

    await expect(
      act(async () => {
        await revoke("some-other-device");
      })
    ).rejects.toThrow("Network unavailable");

    expect(screen.getByTestId("status").textContent).toBe("loggedIn");
    expect(api.clearToken).not.toHaveBeenCalled();
  });
});
