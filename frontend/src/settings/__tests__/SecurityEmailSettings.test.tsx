// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SecuritySettings } from "../SecuritySettings";
import type { useApp } from "../../context/AppContext";

const mocks = vi.hoisted(() => ({ requestEmailChange: vi.fn() }));

vi.mock("../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/api")>()),
  requestEmailChange: (...args: unknown[]) => mocks.requestEmailChange(...args),
}));
vi.mock("../SessionList", () => ({ SessionList: () => <div>Sessions</div> }));
vi.mock("../BiometricLoginSettings", () => ({ BiometricLoginSettings: () => null }));
vi.mock("../../context/AppContext", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../context/AppContext")>()),
  useApp: () => ({
    user: { email: "old@example.com" },
    changePassword: vi.fn(),
    loadSessions: vi.fn(),
  }) as unknown as ReturnType<typeof useApp>,
}));

beforeEach(() => {
  mocks.requestEmailChange.mockReset();
  mocks.requestEmailChange.mockResolvedValue({
    pendingEmail: "new@example.com",
    message: "Verification sent. Your current email stays active until you confirm the new address.",
  });
});
afterEach(cleanup);

describe("SecuritySettings email change", () => {
  it("requires the current password and shows the pending-verification result", async () => {
    const user = userEvent.setup();
    render(<SecuritySettings />);
    await user.type(screen.getByLabelText("New email"), "new@example.com");
    await user.type(screen.getByLabelText("Confirm with current password"), "unchanged-password");
    await user.click(screen.getByRole("button", { name: "Send verification link" }));

    await waitFor(() => expect(mocks.requestEmailChange).toHaveBeenCalledWith("unchanged-password", "new@example.com", false));
    expect(screen.getByText(/current email stays active/i)).toBeTruthy();
    expect((screen.getByLabelText("Confirm with current password") as HTMLInputElement).value).toBe("");
  });

  it("does not silently accept a likely domain typo", async () => {
    const user = userEvent.setup();
    render(<SecuritySettings />);
    const email = screen.getByLabelText("New email") as HTMLInputElement;
    await user.type(email, "new@gmial.com");
    expect(email.value).toBe("new@gmial.com");
    expect(screen.getByText(/did you mean/i)).toBeTruthy();
    expect(mocks.requestEmailChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Use suggestion" }));
    expect(email.value).toBe("new@gmail.com");
  });
});
