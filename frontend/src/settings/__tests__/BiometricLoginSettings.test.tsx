// @vitest-environment jsdom
//
// Settings → Security's biometric-login control: every capability/status
// combination it has to render (web/PWA → nothing at all, native +
// unenrolled → disabled explanation, native + enrolled → working toggle),
// plus the enable/disable interactions and how each result is communicated.
import { useCallback, useState } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import type { BiometricCapabilities, BiometricEnableResult, BiometricStatus } from "../../platform/biometricAuth";
import { BiometricLoginSettings } from "../BiometricLoginSettings";

type AppCtx = ReturnType<typeof useApp>;

let isNativePlatform = true;
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => isNativePlatform },
}));

let capabilities: BiometricCapabilities;
let status: BiometricStatus;
let enableImpl: () => Promise<BiometricEnableResult>;
let disableImpl: () => Promise<void>;
let busy: boolean;

function useFakeApp(): AppCtx {
  const [currentStatus, setCurrentStatus] = useState(status);
  const enableBiometricLogin = useCallback(async () => {
    const result = await enableImpl();
    if (result.outcome === "enabled") {
      setCurrentStatus({ enabled: true, accountId: "u1", accountLabel: "Sam", kind: capabilities.kind });
    }
    return result;
  }, []);
  const disableBiometricLogin = useCallback(async () => {
    await disableImpl();
    setCurrentStatus({ enabled: false });
  }, []);

  return {
    biometricCapabilities: capabilities,
    biometricStatus: currentStatus,
    biometricBusy: busy,
    enableBiometricLogin,
    disableBiometricLogin,
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

beforeEach(() => {
  isNativePlatform = true;
  capabilities = { kind: "faceId", enrolled: true };
  status = { enabled: false };
  busy = false;
  enableImpl = vi.fn(async () => ({ outcome: "enabled" as const, kind: "faceId" as const }));
  disableImpl = vi.fn(async () => undefined);
});

afterEach(cleanup);

describe("BiometricLoginSettings", () => {
  it("renders nothing at all on web/PWA, even if capabilities somehow claim enrollment", () => {
    isNativePlatform = false;
    capabilities = { kind: "faceId", enrolled: true };
    const { container } = render(<BiometricLoginSettings />);
    expect(container.firstChild).toBeNull();
  });

  it("shows a disabled control with the platform's explanation when nothing is enrolled", () => {
    capabilities = { kind: "faceId", enrolled: false, reason: "Face ID is not set up on this device." };
    render(<BiometricLoginSettings />);

    expect(screen.getByText("Face ID is not set up on this device.")).toBeTruthy();
    // Nothing here is a real control — no button to click.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows a Face ID toggle labeled correctly when the device supports it", () => {
    capabilities = { kind: "faceId", enrolled: true };
    render(<BiometricLoginSettings />);
    expect(screen.getByRole("button", { name: "Use Face ID" })).toBeTruthy();
  });

  it("shows a Touch ID toggle when that's the detected kind", () => {
    capabilities = { kind: "touchId", enrolled: true };
    render(<BiometricLoginSettings />);
    expect(screen.getByRole("button", { name: "Use Touch ID" })).toBeTruthy();
  });

  it("prompts immediately on enable and reports success", async () => {
    const user = userEvent.setup();
    render(<BiometricLoginSettings />);

    await user.click(screen.getByRole("button", { name: "Use Face ID" }));

    expect(enableImpl).toHaveBeenCalledOnce();
    await screen.findByText(/Face ID sign-in is on/);
    expect((await screen.findByRole("button", { name: "Turn off Face ID" })).getAttribute("aria-pressed")).toBe("true");
  });

  it("stays off with no error banner when the user cancels enabling", async () => {
    enableImpl = vi.fn(async () => ({ outcome: "failed" as const, reason: "user_cancelled" as const }));
    const user = userEvent.setup();
    render(<BiometricLoginSettings />);

    await user.click(screen.getByRole("button", { name: "Use Face ID" }));

    await waitFor(() => expect(enableImpl).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Use Face ID" }).getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a specific error banner for a genuine enable failure (not a cancel)", async () => {
    enableImpl = vi.fn(async () => ({
      outcome: "failed" as const,
      reason: "authentication_failed" as const,
      error: "Face ID did not recognize you.",
    }));
    const user = userEvent.setup();
    render(<BiometricLoginSettings />);

    await user.click(screen.getByRole("button", { name: "Use Face ID" }));
    await screen.findByText("Face ID did not recognize you.");
  });

  it("disables without prompting, and confirms", async () => {
    status = { enabled: true, accountId: "u1", accountLabel: "Sam", kind: "faceId" };
    const user = userEvent.setup();
    render(<BiometricLoginSettings />);

    await user.click(screen.getByRole("button", { name: "Turn off Face ID" }));

    expect(disableImpl).toHaveBeenCalledOnce();
    await screen.findByText("Face ID sign-in turned off.");
    expect((await screen.findByRole("button", { name: "Use Face ID" })).getAttribute("aria-pressed")).toBe("false");
  });

  it("disables the toggle while a prompt is in flight, so a second tap can't start a second prompt", () => {
    busy = true;
    render(<BiometricLoginSettings />);
    // The label itself switches to "Confirming…" while busy (see
    // StableLabel usage in the component) — there's exactly one button in
    // this render, so querying without a name filter is unambiguous.
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });
});
