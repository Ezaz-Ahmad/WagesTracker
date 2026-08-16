// @vitest-environment jsdom
//
// useShiftNotificationSetting backs the "Shift notification" Settings
// toggle (ShiftNotificationSettings.tsx). It is deliberately just a
// persisted preference — see its own doc comment for why it doesn't reach
// into shift/app state to react to an already-open shift — so what's
// covered here is: it reflects whatever's currently stored on mount, it
// persists a new value via setShiftNotificationEnabled, and it never calls
// anything shift-related. Direct localStorage coverage of the preference
// itself lives in platform/__tests__/shiftNotificationPreference.test.ts;
// useTodayShift.notifications.test.tsx covers start() actually reading it.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShiftNotificationSetting } from "../useTodayShift";

const postShiftStartedNotification = vi.fn().mockResolvedValue({ ok: true });
const clearShiftNotification = vi.fn().mockResolvedValue(undefined);
let storedPreference: boolean;
const setShiftNotificationEnabled = vi.fn((next: boolean) => {
  storedPreference = next;
});
vi.mock("../../platform/shiftNotifications", () => ({
  postShiftStartedNotification: (...args: unknown[]) => postShiftStartedNotification(...args),
  clearShiftNotification: (...args: unknown[]) => clearShiftNotification(...args),
  isShiftNotificationEnabled: () => storedPreference,
  setShiftNotificationEnabled: (next: boolean) => setShiftNotificationEnabled(next),
}));

function Harness() {
  const { enabled, setEnabled } = useShiftNotificationSetting();
  return (
    <div>
      <div data-testid="enabled">{String(enabled)}</div>
      <button type="button" onClick={() => setEnabled(!enabled)}>
        toggle
      </button>
    </div>
  );
}

beforeEach(() => {
  storedPreference = true;
  postShiftStartedNotification.mockClear();
  clearShiftNotification.mockClear();
  setShiftNotificationEnabled.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("useShiftNotificationSetting", () => {
  it("reflects the currently-stored preference on mount", () => {
    storedPreference = false;
    render(<Harness />);
    expect(screen.getByTestId("enabled").textContent).toBe("false");
  });

  it("persists the new value via setShiftNotificationEnabled and updates its own returned state", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.getByTestId("enabled").textContent).toBe("true");

    await user.click(screen.getByRole("button"));

    expect(setShiftNotificationEnabled).toHaveBeenCalledWith(false);
    await waitFor(() => expect(screen.getByTestId("enabled").textContent).toBe("false"));
  });

  it("toggles back and forth correctly across repeated flips", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByTestId("enabled").textContent).toBe("false"));
    await user.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByTestId("enabled").textContent).toBe("true"));

    expect(setShiftNotificationEnabled).toHaveBeenNthCalledWith(1, false);
    expect(setShiftNotificationEnabled).toHaveBeenNthCalledWith(2, true);
  });

  it("never calls postShiftStartedNotification or clearShiftNotification — it only ever touches the preference itself", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button"));
    await user.click(screen.getByRole("button"));

    expect(postShiftStartedNotification).not.toHaveBeenCalled();
    expect(clearShiftNotification).not.toHaveBeenCalled();
  });
});
