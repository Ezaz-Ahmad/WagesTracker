// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isoDate } from "../../lib/date";
import { makeUserEarnings } from "./adminEarningsFixtures";

expect.extend(toHaveNoViolations);

const fetchAllUsers = vi.fn();
const fetchUserDetail = vi.fn();
const fetchUserEarnings = vi.fn();
const updateUserEmail = vi.fn();
const deleteUser = vi.fn();
const adminLogin = vi.fn();

vi.mock("../adminApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adminApi")>();
  return { ...actual, fetchAllUsers, fetchUserDetail, fetchUserEarnings, updateUserEmail, deleteUser, adminLogin };
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

beforeEach(() => {
  const earnings = makeUserEarnings(isoDate(new Date()));
  fetchAllUsers.mockResolvedValue({ users: [{ ...SUMMARY, earnings: earnings.week, previousEarnings: earnings.previousWeek }] });
  fetchUserEarnings.mockImplementation((_id: string, date: string) => Promise.resolve(makeUserEarnings(date)));
  fetchUserDetail.mockResolvedValue({
    user: USER,
    shifts: [{ id: "shift-1", date: "2026-08-28", location: "Central Store", signIn: "09:00", signOut: "17:00" }],
  });
  deleteUser.mockResolvedValue(undefined);
  updateUserEmail.mockResolvedValue({ user: USER, message: "Email updated." });
  adminLogin.mockResolvedValue({ token: "test-token" });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("admin accessibility and request lifecycle", () => {
  it("gives the login a single h1 and an associated password label", async () => {
    const { container } = render(<AdminLogin onLoggedIn={() => {}} />);
    expect(screen.getByRole("heading", { name: "Admin login", level: 1 })).toBeTruthy();
    expect(screen.getByLabelText("Admin password")).toBeTruthy();
    expect(await axe(container, { rules: { "color-contrast": { enabled: false } } })).toHaveNoViolations();
  });

  it("labels the dashboard search, actions column, and modal structure", async () => {
    const user = userEvent.setup();
    render(<AdminDashboard onLogout={() => {}} onAuthError={() => false} />);

    expect(await screen.findByRole("heading", { name: "Admin dashboard", level: 1 })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "User directory", level: 2 })).toBeTruthy();
    expect(screen.getByLabelText("Search users")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy();
    expect(screen.getByText("test@example.com").getAttribute("data-label")).toBe("Email");

    await user.click(screen.getByRole("button", { name: "View Long Test User" }));
    const detail = await screen.findByRole("dialog", { name: "Long Test User" });
    expect(document.activeElement && detail.contains(document.activeElement)).toBe(true);
    expect(await within(detail).findByRole("group", { name: "Daily earnings by day" })).toBeTruthy();
    expect(within(detail).getByLabelText("Select a week")).toBeTruthy();
    await user.click(within(detail).getByText("View daily figures"));
    expect(await axe(document.body, { rules: { "color-contrast": { enabled: false } } })).toHaveNoViolations();

    await user.click(within(detail).getByRole("button", { name: "Account & shifts" }));
    expect(within(detail).getByLabelText("Email")).toBeTruthy();
    expect(await axe(document.body, { rules: { "color-contrast": { enabled: false } } })).toHaveNoViolations();

    await user.click(within(detail).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Long Test User" })).toBeNull());
    await user.click(screen.getByRole("button", { name: "Delete Long Test User" }));
    const warning = await screen.findByRole("alertdialog", { name: "Delete Long Test User?" });
    expect(within(warning).getByLabelText("Confirm email")).toBeTruthy();
    expect(warning.textContent).toMatch(/signed-in devices, shifts, expenses, and spending categories/);
  });

  it("shows a user-detail request failure instead of silently discarding it", async () => {
    fetchUserDetail.mockRejectedValueOnce(new Error("Detail service unavailable"));
    const user = userEvent.setup();
    render(<AdminDashboard onLogout={() => {}} onAuthError={() => false} />);
    await screen.findByText("Long Test User");
    await user.click(screen.getByRole("button", { name: "View Long Test User" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't load user");
  });

  it("ignores pending account details after the admin opens the delete confirmation", async () => {
    const pending = deferred<{ user: typeof USER; shifts: [] }>();
    fetchUserDetail.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    render(<AdminDashboard onLogout={() => {}} onAuthError={() => false} />);
    await screen.findByText("Long Test User");
    await user.click(screen.getByRole("button", { name: "View Long Test User" }));
    expect(fetchUserDetail).toHaveBeenCalledWith(USER.id);
    await user.click(screen.getByRole("button", { name: "Delete Long Test User" }));
    const warning = await screen.findByRole("alertdialog", { name: "Delete Long Test User?" });

    await act(async () => { pending.resolve({ user: USER, shifts: [] }); });
    expect(screen.queryByRole("dialog", { name: "Long Test User" })).toBeNull();
    expect(screen.getByRole("alertdialog", { name: "Delete Long Test User?" })).toBe(warning);
    expect(within(warning).getByLabelText("Confirm email")).toBeTruthy();
  });

  it("keeps the newly opened account intact when another account's delayed email save completes", async () => {
    const user = userEvent.setup();
    const secondUser = { ...USER, id: "user-2", name: "Second Test User", email: "second@example.com" };
    const earnings = makeUserEarnings(isoDate(new Date()));
    const weeklyFigures = { earnings: earnings.week, previousEarnings: earnings.previousWeek };
    fetchAllUsers.mockResolvedValue({ users: [{ ...SUMMARY, ...weeklyFigures }, { ...secondUser, ...weeklyFigures }] });
    fetchUserDetail.mockImplementation((id: string) => Promise.resolve({ user: id === USER.id ? USER : secondUser, shifts: [] }));
    const pending = deferred<{ user: typeof USER; message: string }>();
    updateUserEmail.mockReturnValueOnce(pending.promise);
    render(<AdminDashboard onLogout={() => {}} onAuthError={() => false} />);
    await screen.findByText("Long Test User");

    await user.click(screen.getByRole("button", { name: "View Long Test User" }));
    const firstDetail = await screen.findByRole("dialog", { name: "Long Test User" });
    await user.click(within(firstDetail).getByRole("button", { name: "Account & shifts" }));
    const firstEmail = within(firstDetail).getByLabelText("Email");
    await user.clear(firstEmail);
    await user.type(firstEmail, "updated@example.com");
    await user.click(within(firstDetail).getByRole("button", { name: "Update email" }));
    expect(updateUserEmail).toHaveBeenCalledWith(USER.id, "updated@example.com", false);
    await user.click(within(firstDetail).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Long Test User" })).toBeNull());

    await user.click(screen.getByRole("button", { name: "View Second Test User" }));
    const secondDetail = await screen.findByRole("dialog", { name: "Second Test User" });
    await user.click(within(secondDetail).getByRole("button", { name: "Account & shifts" }));
    expect((within(secondDetail).getByLabelText("Email") as HTMLInputElement).value).toBe("second@example.com");

    await act(async () => { pending.resolve({ user: { ...USER, email: "updated@example.com" }, message: "First account email updated." }); });
    expect(screen.getByRole("dialog", { name: "Second Test User" })).toBe(secondDetail);
    expect((within(secondDetail).getByLabelText("Email") as HTMLInputElement).value).toBe("second@example.com");
    expect(within(secondDetail).queryByText("First account email updated.")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Long Test User" })).toBeNull();
  });
});
