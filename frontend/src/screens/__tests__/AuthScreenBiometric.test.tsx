// @vitest-environment jsdom
//
// The login screen's Face ID/Touch ID icon: shown only once biometric login
// has previously been enabled for the account, labeled for whichever kind
// the device actually has, and wired to the manual-retry action rather than
// a fresh login attempt.
import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import type { BiometricStatus } from "../../platform/biometricAuth";
import { AuthScreen } from "../AuthScreen";

type AppCtx = ReturnType<typeof useApp>;

let biometricStatus: BiometricStatus;
let biometricBusy: boolean;
let biometricLoginError: string | null;
let retryBiometricLogin: ReturnType<typeof vi.fn<() => void>>;
let clearBiometricLoginError: ReturnType<typeof vi.fn<() => void>>;

function useFakeApp(): AppCtx {
  const [, forceRerender] = useState(0);
  return {
    login: vi.fn(),
    signup: vi.fn(),
    authError: null,
    authBusy: false,
    clearAuthError: vi.fn(),
    biometricStatus,
    biometricBusy,
    biometricLoginError,
    clearBiometricLoginError: () => {
      clearBiometricLoginError();
      forceRerender((n) => n + 1);
    },
    retryBiometricLogin,
  } as unknown as AppCtx;
}

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return { ...actual, useApp: () => useFakeApp() };
});

// AuthScreen reads a remembered email from lib/api directly (not through
// context) to pre-fill the field — irrelevant to this test, stubbed so it
// never touches real localStorage under jsdom.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, getRememberedEmail: () => null };
});

beforeEach(() => {
  biometricStatus = { enabled: false };
  biometricBusy = false;
  biometricLoginError = null;
  retryBiometricLogin = vi.fn();
  clearBiometricLoginError = vi.fn();
});

afterEach(cleanup);

describe("AuthScreen biometric icon", () => {
  it("is absent when biometric login has never been enabled", () => {
    render(<AuthScreen />);
    expect(screen.queryByRole("button", { name: /Sign in with/ })).toBeNull();
  });

  it("shows the Face ID icon, correctly labeled, once enabled", () => {
    biometricStatus = { enabled: true, kind: "faceId", accountId: "u1", accountLabel: "Sam" };
    render(<AuthScreen />);
    expect(screen.getByRole("button", { name: "Sign in with Face ID" })).toBeTruthy();
  });

  it("shows the Touch ID icon, correctly labeled, when that's the enrolled kind", () => {
    biometricStatus = { enabled: true, kind: "touchId", accountId: "u1", accountLabel: "Sam" };
    render(<AuthScreen />);
    expect(screen.getByRole("button", { name: "Sign in with Touch ID" })).toBeTruthy();
  });

  it("restarts biometric authentication when pressed", async () => {
    biometricStatus = { enabled: true, kind: "faceId", accountId: "u1", accountLabel: "Sam" };
    const user = userEvent.setup();
    render(<AuthScreen />);

    await user.click(screen.getByRole("button", { name: "Sign in with Face ID" }));
    expect(retryBiometricLogin).toHaveBeenCalledOnce();
  });

  it("disables the icon while a prompt is already in flight, so a second tap can't start a second one", () => {
    biometricStatus = { enabled: true, kind: "faceId", accountId: "u1", accountLabel: "Sam" };
    biometricBusy = true;
    render(<AuthScreen />);
    expect(screen.getByRole("button", { name: "Sign in with Face ID" }).hasAttribute("disabled")).toBe(true);
  });

  it("shows a dismissible error banner from a failed biometric attempt, separate from a password authError", () => {
    biometricStatus = { enabled: true, kind: "faceId", accountId: "u1", accountLabel: "Sam" };
    biometricLoginError = "Face ID or Touch ID did not recognize you.";
    render(<AuthScreen />);
    expect(screen.getByText("Face ID or Touch ID did not recognize you.")).toBeTruthy();
  });

  it("hides the icon in signup mode", async () => {
    biometricStatus = { enabled: true, kind: "faceId", accountId: "u1", accountLabel: "Sam" };
    const user = userEvent.setup();
    render(<AuthScreen />);
    await user.click(screen.getByRole("radio", { name: "Create account" }));
    expect(screen.queryByRole("button", { name: /Sign in with/ })).toBeNull();
  });
});
