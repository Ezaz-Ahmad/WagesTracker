// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VerifyEmailPage } from "../VerifyEmailPage";

const mocks = vi.hoisted(() => ({ verifyEmail: vi.fn() }));
vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  verifyEmail: (...args: unknown[]) => mocks.verifyEmail(...args),
}));

beforeEach(() => mocks.verifyEmail.mockReset());
afterEach(cleanup);

describe("VerifyEmailPage", () => {
  it("confirms signup ownership and directs the user to unchanged-password login", async () => {
    mocks.verifyEmail.mockResolvedValue({
      verified: true,
      purpose: "signup",
      email: "sam@example.com",
      message: "Email verified. You can now log in with the password you chose.",
    });
    render(<VerifyEmailPage token={"x".repeat(43)} />);
    await waitFor(() => expect(screen.getByText(/email verified/i)).toBeTruthy());
    expect(screen.getByText("sam@example.com")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to log in" }).getAttribute("href")).toBe("/");
  });

  it("explains an incomplete or expired link", () => {
    window.history.replaceState({}, "", "/verify-email");
    render(<VerifyEmailPage token="" />);
    expect(screen.getByText(/verification link is incomplete/i)).toBeTruthy();
    expect(screen.getByText(/work once and expire after 24 hours/i)).toBeTruthy();
  });
});
