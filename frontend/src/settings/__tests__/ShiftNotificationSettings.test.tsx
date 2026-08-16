// @vitest-environment jsdom
//
// Settings → Security's "Shift notification" toggle: native-only rendering
// (mirroring BiometricLoginSettings.test.tsx), the label/hint reflecting
// current state, and that a tap actually flips the underlying preference.
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShiftNotificationSettings } from "../ShiftNotificationSettings";

let isNativePlatform = true;
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform },
}));

let enabled: boolean;
const setEnabled = vi.fn((next: boolean) => {
  enabled = next;
});
vi.mock("../../lib/useTodayShift", () => ({
  useShiftNotificationSetting: () => ({ enabled, setEnabled: (next: boolean) => setEnabled(next) }),
}));

beforeEach(() => {
  isNativePlatform = true;
  enabled = true;
  setEnabled.mockClear();
});

afterEach(cleanup);

describe("ShiftNotificationSettings", () => {
  it("renders nothing at all on web/PWA", () => {
    isNativePlatform = false;
    const { container } = render(<ShiftNotificationSettings />);
    expect(container.firstChild).toBeNull();
  });

  it("shows the on state with a control to turn it off", () => {
    enabled = true;
    render(<ShiftNotificationSettings />);
    expect(screen.getByRole("button", { name: "Turn off shift notification" }).getAttribute("aria-pressed")).toBe(
      "true"
    );
    expect(screen.getByText(/stays in your notification center/)).toBeTruthy();
  });

  it("shows the off state with a control to turn it on", () => {
    enabled = false;
    render(<ShiftNotificationSettings />);
    expect(screen.getByRole("button", { name: "Turn on shift notification" }).getAttribute("aria-pressed")).toBe(
      "false"
    );
    expect(screen.getByText(/Turned off/)).toBeTruthy();
  });

  it("calls setEnabled(false) when tapped while on", async () => {
    enabled = true;
    const user = userEvent.setup();
    render(<ShiftNotificationSettings />);

    await user.click(screen.getByRole("button", { name: "Turn off shift notification" }));

    expect(setEnabled).toHaveBeenCalledWith(false);
  });

  it("calls setEnabled(true) when tapped while off", async () => {
    enabled = false;
    const user = userEvent.setup();
    render(<ShiftNotificationSettings />);

    await user.click(screen.getByRole("button", { name: "Turn on shift notification" }));

    expect(setEnabled).toHaveBeenCalledWith(true);
  });
});
