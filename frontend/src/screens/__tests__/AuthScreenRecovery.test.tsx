// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useApp } from "../../context/AppContext";
import { AuthScreen } from "../AuthScreen";

type AppContextValue = ReturnType<typeof useApp>;
const apiMocks = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));
const NEUTRAL = "If an account exists for this email, we've sent password reset instructions.";

const login = vi.fn();
const signup = vi.fn();
const clearAuthError = vi.fn();

vi.mock("../../context/AppContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../context/AppContext")>();
  return {
    ...actual,
    useApp: () => ({
      login,
      signup,
      authError: null,
      authBusy: false,
      clearAuthError,
      biometricStatus: { enabled: false },
      biometricBusy: false,
      biometricLoginError: null,
      clearBiometricLoginError: vi.fn(),
      retryBiometricLogin: vi.fn(),
    }) as unknown as AppContextValue,
  };
});

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    getRememberedEmail: () => null,
    requestPasswordReset: (...args: unknown[]) => apiMocks.requestPasswordReset(...args),
  };
});

beforeEach(() => {
  apiMocks.requestPasswordReset.mockReset();
  apiMocks.requestPasswordReset.mockResolvedValue({ message: NEUTRAL });
});
afterEach(cleanup);

describe("forgot-password auth flow", () => {
  it("offers a real button beside the password field", () => {
    render(<AuthScreen />);
    const control = screen.getByRole("button", { name: "Forgot password?" });
    expect(control.tagName).toBe("BUTTON");
  });

  it("opens the recovery form, preserves the typed email, and hides the login/signup switch", async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);
    await user.type(screen.getByLabelText("Email"), "sam@example.com");
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));

    expect(screen.getByRole("heading", { name: "Forgot your password?" })).toBeTruthy();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("sam@example.com");
    expect(screen.queryByLabelText("Create account")).toBeNull();
    expect(screen.queryByLabelText("Log in")).toBeNull();
  });

  it("shows the server's neutral success message verbatim", async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    await user.type(screen.getByLabelText("Email"), "nobody@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => expect(screen.getByText(NEUTRAL)).toBeTruthy());
    expect(apiMocks.requestPasswordReset).toHaveBeenCalledWith("nobody@example.com");
    expect(screen.queryByText(/no account found/i)).toBeNull();
    expect(screen.queryByText(/doesn't exist/i)).toBeNull();
  });

  it("surfaces network/configuration failures without showing a false success", async () => {
    apiMocks.requestPasswordReset.mockRejectedValue(new Error("Password reset is temporarily unavailable."));
    const user = userEvent.setup();
    render(<AuthScreen />);
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    await user.type(screen.getByLabelText("Email"), "sam@example.com");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => expect(screen.getByText("Password reset is temporarily unavailable.")).toBeTruthy());
    expect(screen.queryByText(NEUTRAL)).toBeNull();
  });

  it("returns to login without reloading the page", async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);
    await user.click(screen.getByRole("button", { name: "Forgot password?" }));
    await user.click(screen.getByRole("button", { name: "Back to log in" }));
    expect(screen.getByRole("heading", { name: "Log in to your account" })).toBeTruthy();
  });

  it("requires a positive two-decimal hourly rate before account creation", async () => {
    const user = userEvent.setup();
    render(<AuthScreen />);
    await user.click(screen.getByLabelText("Create account"));

    const createButton = screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement;
    const rateInput = screen.getByLabelText(/Hourly rate/);
    expect((rateInput as HTMLInputElement).required).toBe(true);
    expect(createButton.disabled).toBe(true);

    await user.type(rateInput, "18.501");
    expect(screen.getByText("Use no more than two decimal places.")).toBeTruthy();
    expect(createButton.disabled).toBe(true);

    await user.clear(rateInput);
    await user.type(rateInput, "18.50");
    expect(createButton.disabled).toBe(false);
  });
});
