// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

expect.extend(toHaveNoViolations);

const fetchAllUsers = vi.fn();
const fetchUserDetail = vi.fn();
const deleteUser = vi.fn();
const adminLogin = vi.fn();

vi.mock("../adminApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adminApi")>();
  return { ...actual, fetchAllUsers, fetchUserDetail, deleteUser, adminLogin };
});

const { AdminDashboard } = await import("../AdminDashboard");
const { AdminLogin } = await import("../AdminLogin");

const SUMMARY = {
  id: "user-1",
  name: "Long Test User",
  email: "test@example.com",
  workLocationName: "Central Store",
  workAddress: "1 Main Street",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Monday" as const,
  rate: 28.5,
  goalHours: 35,
  goalEarnings: 997.5,
  createdAt: "2026-01-01T00:00:00.000Z",
  shiftCount: 1,
};

const USER = {
  ...SUMMARY,
  address: "1 Home Street",
};

beforeEach(() => {
  fetchAllUsers.mockResolvedValue({ users: [SUMMARY] });
  fetchUserDetail.mockResolvedValue({
    user: USER,
    shifts: [{ id: "shift-1", date: "2026-08-28", location: "Central Store", signIn: "09:00", signOut: "17:00" }],
  });
  deleteUser.mockResolvedValue(undefined);
  adminLogin.mockResolvedValue({ token: "test-token" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin accessibility", () => {
  it("gives the login a single h1 and an associated password label", async () => {
    const { container } = render(<AdminLogin onLoggedIn={() => {}} />);
    expect(screen.getByRole("heading", { name: "Admin login", level: 1 })).toBeTruthy();
    expect(screen.getByLabelText("Admin password")).toBeTruthy();
    expect(await axe(container, { rules: { "color-contrast": { enabled: false } } })).toHaveNoViolations();
  });

  it("labels the dashboard search, actions column, and modal structure", async () => {
    const user = userEvent.setup();
    render(<AdminDashboard onLogout={() => {}} onAuthError={() => false} />);

    expect(await screen.findByRole("heading", { name: "All users", level: 1 })).toBeTruthy();
    expect(screen.getByLabelText("Search users")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "View" }));
    const detail = await screen.findByRole("dialog", { name: "Long Test User" });
    expect(document.activeElement && detail.contains(document.activeElement)).toBe(true);
    expect(await axe(document.body, { rules: { "color-contrast": { enabled: false } } })).toHaveNoViolations();

    await user.click(within(detail).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Long Test User" })).toBeNull());
    await user.click(screen.getByRole("button", { name: "Delete" }));
    const warning = await screen.findByRole("alertdialog", { name: "Delete Long Test User?" });
    expect(within(warning).getByLabelText("Confirm email")).toBeTruthy();
    expect(warning.textContent).toMatch(/sessions, shifts, expenses, and spending categories/);
  });

  it("shows a user-detail request failure instead of silently discarding it", async () => {
    fetchUserDetail.mockRejectedValueOnce(new Error("Detail service unavailable"));
    const user = userEvent.setup();
    render(<AdminDashboard onLogout={() => {}} onAuthError={() => false} />);
    await screen.findByText("Long Test User");
    await user.click(screen.getByRole("button", { name: "View" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't load user");
  });
});
