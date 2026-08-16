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

// The real default is `false` — the whole feature is temporarily paused
// (see isShiftNotificationFeatureEnabled's doc comment in
// platform/shiftNotifications.ts) — but this file's job is proving the
// still-fully-implemented toggle itself renders and works correctly, so
// it's forced on here, same as `enabled`/`isNativePlatform` above. The one
// test specifically about the kill-switch's own effect sets this back to
// false.
let featureEnabled: boolean;
vi.mock("../../platform/shiftNotifications", () => ({
  isShiftNotificationFeatureEnabled: () => featureEnabled,
}));

beforeEach(() => {
  isNativePlatform = true;
  enabled = true;
  featureEnabled = true;
  setEnabled.mockClear();
});

afterEach(cleanup);

describe("ShiftNotificationSettings", () => {
  it("renders nothing at all on web/PWA", () => {
    isNativePlatform = false;
    const { container } = render(<ShiftNotificationSettings />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing while the feature is temporarily disabled, even natively with the preference on", () => {
    featureEnabled = false;
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
