// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api";
import { ResetPasswordPage } from "../ResetPasswordPage";

const apiMocks = vi.hoisted(() => ({
  checkPasswordResetToken: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    checkPasswordResetToken: (...args: unknown[]) => apiMocks.checkPasswordResetToken(...args),
    resetPassword: (...args: unknown[]) => apiMocks.resetPassword(...args),
  };
});

function visit(fragment = "") {
  window.history.replaceState({}, "", `/reset-password${fragment}`);
}

beforeEach(() => {
  apiMocks.checkPasswordResetToken.mockReset();
  apiMocks.resetPassword.mockReset();
});
afterEach(cleanup);

describe("reset-password page", () => {
  it("takes the token from a fragment and removes it from the address bar before rendering the form", async () => {
    apiMocks.checkPasswordResetToken.mockResolvedValue({ valid: true });
    visit("#token=super-secret-token");
    render(<ResetPasswordPage />);

    await waitFor(() => expect(screen.getByLabelText("New password")).toBeTruthy());
    expect(apiMocks.checkPasswordResetToken).toHaveBeenCalledWith("super-secret-token");
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/reset-password");
  });

  it("shows a useful invalid-link state without presenting a doomed form", async () => {
    apiMocks.checkPasswordResetToken.mockRejectedValue(
      new ApiError("This password reset link is no longer valid. Request a new one and try again.", 400, "INVALID_RESET_TOKEN")
    );
    visit("#token=dead-token");
    render(<ResetPasswordPage />);

    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeTruthy());
    expect(screen.queryByLabelText("New password")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Wage Tracker" })).toBeTruthy();
  });

  it("distinguishes a connectivity problem from an expired credential", async () => {
    apiMocks.checkPasswordResetToken.mockRejectedValue(new ApiError("network", 0));
    visit("#token=anything");
    render(<ResetPasswordPage />);
    await waitFor(() => expect(screen.getByText(/couldn't reach Wage Tracker/i)).toBeTruthy());
  });

  it("applies password policy and matching checks before submitting", async () => {
    apiMocks.checkPasswordResetToken.mockResolvedValue({ valid: true });
    visit("#token=good-token");
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await waitFor(() => expect(screen.getByLabelText("New password")).toBeTruthy());

    await user.type(screen.getByLabelText("New password"), "short");
    expect(screen.getByText(/at least 15 characters/i)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Set new password" }) as HTMLButtonElement).disabled).toBe(true);

    await user.clear(screen.getByLabelText("New password"));
    await user.type(screen.getByLabelText("New password"), "a-perfectly-good-passphrase-2026");
    await user.type(screen.getByLabelText("Confirm new password"), "a-different-good-passphrase-2026");
    expect(screen.getByText("Passwords don't match")).toBeTruthy();
    expect(apiMocks.resetPassword).not.toHaveBeenCalled();
  });

  it("submits once and clearly explains success and session revocation", async () => {
    apiMocks.checkPasswordResetToken.mockResolvedValue({ valid: true });
    apiMocks.resetPassword.mockResolvedValue({ message: "Your password has been reset. You can now log in with your new password." });
    visit("#token=good-token");
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await waitFor(() => expect(screen.getByLabelText("New password")).toBeTruthy());

    const password = "a-perfectly-good-passphrase-2026";
    await user.type(screen.getByLabelText("New password"), password);
    await user.type(screen.getByLabelText("Confirm new password"), password);
    await user.click(screen.getByRole("button", { name: "Set new password" }));

    await waitFor(() => expect(screen.getByText(/Every previously signed-in device has been signed out/i)).toBeTruthy());
    expect(apiMocks.resetPassword).toHaveBeenCalledWith("good-token", password);
    expect(screen.getByRole("link", { name: "Go to log in" })).toBeTruthy();
  });

  it("falls back to the invalid state if the token expires between validation and submission", async () => {
    apiMocks.checkPasswordResetToken.mockResolvedValue({ valid: true });
    apiMocks.resetPassword.mockRejectedValue(new ApiError("This password reset link is no longer valid.", 400, "INVALID_RESET_TOKEN"));
    visit("#token=racing-token");
    const user = userEvent.setup();
    render(<ResetPasswordPage />);
    await waitFor(() => expect(screen.getByLabelText("New password")).toBeTruthy());

    const password = "a-perfectly-good-passphrase-2026";
    await user.type(screen.getByLabelText("New password"), password);
    await user.type(screen.getByLabelText("Confirm new password"), password);
    await user.click(screen.getByRole("button", { name: "Set new password" }));

    await waitFor(() => expect(screen.getByText(/no longer valid/i)).toBeTruthy());
    expect(screen.queryByLabelText("New password")).toBeNull();
  });
});
