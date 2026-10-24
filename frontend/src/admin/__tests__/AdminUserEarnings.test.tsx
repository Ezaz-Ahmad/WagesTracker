// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isoDate } from "../../lib/date";
import { addIsoDays, startOfWeekISO } from "../../lib/weekBoundary.mjs";
import type { AdminUserEarnings as EarningsData } from "../adminApi";
import { ADMIN_TEST_USER, makeEarningsWeek, makeUserEarnings } from "./adminEarningsFixtures";

const fetchUserEarnings = vi.fn();
vi.mock("../adminApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adminApi")>();
  return { ...actual, fetchUserEarnings };
});

const { AdminUserEarnings } = await import("../AdminUserEarnings");
const { AdminApiError } = await import("../adminApi");

function weeklyTotal() {
  const summary = screen.getByText("Total earned · AUD").parentElement;
  if (!summary) throw new Error("Missing weekly earnings summary");
  return within(summary);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

beforeEach(() => {
  fetchUserEarnings.mockReset();
  fetchUserEarnings.mockImplementation((_id: string, date: string) => Promise.resolve(makeUserEarnings(date)));
});

afterEach(cleanup);

describe("AdminUserEarnings", () => {
  it("shows wages, fuel and weekly extras in the total while keeping daily earnings separate", async () => {
    const today = isoDate(new Date());
    render(<AdminUserEarnings user={ADMIN_TEST_USER} initialDate={today} onAuthError={() => false} />);

    await screen.findByText("Total earned · AUD");
    expect(weeklyTotal().getByText("$265.00")).toBeTruthy();
    expect(weeklyTotal().getByText("+$65.00 vs previous week")).toBeTruthy();
    const extras = screen.getByText("Weekly extras").parentElement;
    expect(extras && within(extras).getByText("$25.00")).toBeTruthy();
    expect(screen.getByText("1 unfinished · wages pending")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Weekly earnings goal" }).getAttribute("aria-valuenow")).toBe("53");
    expect(screen.getByRole("button", { name: /\$240\.00 total, \$228\.00 wages, \$12\.00 fuel, 8 hours/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /\$265\.00 total/i })).toBeNull();
    expect(screen.getByText(/Weekly extras are added separately to the total/)).toBeTruthy();
    expect(screen.getByText(/current rate of \$28\.50\/hr/).textContent).toContain("Historical amounts use the current rate.");
    expect(screen.getByText(/This week is still in progress; the comparison uses the full previous week/)).toBeTruthy();
  });

  it("navigates previous and current weeks, offers older weeks, and prevents moving into the future", async () => {
    const user = userEvent.setup();
    const today = isoDate(new Date());
    const currentStart = startOfWeekISO(today, "Monday");
    const previousStart = addIsoDays(currentStart, -7);
    render(<AdminUserEarnings user={ADMIN_TEST_USER} initialDate={today} onAuthError={() => false} />);
    await screen.findByText("Total earned · AUD");
    expect(fetchUserEarnings).toHaveBeenLastCalledWith(ADMIN_TEST_USER.id, today);
    expect((screen.getByLabelText("Select a week") as HTMLSelectElement).value).toBe(currentStart);
    expect((screen.getByRole("button", { name: "Next earnings week" }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: "Previous earnings week" }));
    await waitFor(() => expect(fetchUserEarnings).toHaveBeenLastCalledWith(ADMIN_TEST_USER.id, previousStart));
    expect((screen.getByLabelText("Select a week") as HTMLSelectElement).value).toBe(previousStart);
    expect(screen.getByRole("heading", { name: "Weekly earnings" })).toBeTruthy();
    expect(screen.queryByText(/This week is still in progress/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Next earnings week" }));
    await waitFor(() => expect(fetchUserEarnings).toHaveBeenLastCalledWith(ADMIN_TEST_USER.id, currentStart));
    expect(screen.getByRole("heading", { name: "This week's earnings" })).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("Select a week"), addIsoDays(currentStart, -14));
    await waitFor(() => expect(fetchUserEarnings).toHaveBeenLastCalledWith(ADMIN_TEST_USER.id, addIsoDays(currentStart, -14)));
    await user.click(screen.getByRole("button", { name: "This week" }));
    await waitFor(() => expect(fetchUserEarnings).toHaveBeenLastCalledWith(ADMIN_TEST_USER.id, today));
    expect((screen.getByRole("button", { name: "This week" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses the account's configured Sunday week boundary", async () => {
    const user = userEvent.setup();
    const today = isoDate(new Date());
    const sundayStart = startOfWeekISO(today, "Sunday");
    fetchUserEarnings.mockImplementation((_id: string, date: string) => Promise.resolve(makeUserEarnings(date, "Sunday")));
    render(<AdminUserEarnings user={{ ...ADMIN_TEST_USER, weekStartsOn: "Sunday" }} initialDate={today} onAuthError={() => false} />);
    await screen.findByText("Total earned · AUD");
    expect((screen.getByLabelText("Select a week") as HTMLSelectElement).value).toBe(sundayStart);
    expect(screen.getByText(/Sunday start/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Previous earnings week" }));
    await waitFor(() => expect(fetchUserEarnings).toHaveBeenLastCalledWith(ADMIN_TEST_USER.id, addIsoDays(sundayStart, -7)));
  });

  it("shows a useful failure and retries the same user and week", async () => {
    const user = userEvent.setup();
    const date = "2026-08-24";
    const error = new AdminApiError("Earnings service unavailable", 503);
    const onAuthError = vi.fn(() => false);
    fetchUserEarnings.mockRejectedValueOnce(error);
    render(<AdminUserEarnings user={ADMIN_TEST_USER} initialDate={date} onAuthError={onAuthError} />);

    expect((await screen.findByRole("alert")).textContent).toContain("Earnings service unavailable");
    expect(onAuthError).toHaveBeenCalledWith(error);
    expect(screen.queryByText("Total earned · AUD")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Retry earnings" }));
    await screen.findByText("Total earned · AUD");
    expect(fetchUserEarnings).toHaveBeenCalledTimes(2);
    expect(fetchUserEarnings).toHaveBeenLastCalledWith(ADMIN_TEST_USER.id, date);
    expect(weeklyTotal().getByText("$265.00")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a slow response from the previous selection after the admin changes weeks", async () => {
    const user = userEvent.setup();
    const date = "2026-08-24";
    const previousDate = "2026-08-17";
    const firstRequest = deferred<EarningsData>();
    const previousResponse = makeUserEarnings(previousDate);
    previousResponse.week = makeEarningsWeek(previousDate, { extras: 93 });
    fetchUserEarnings.mockReturnValueOnce(firstRequest.promise).mockResolvedValueOnce(previousResponse);
    render(<AdminUserEarnings user={ADMIN_TEST_USER} initialDate={date} onAuthError={() => false} />);
    expect(screen.getByText("Loading weekly earnings…")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Previous earnings week" }));
    await screen.findByText("Total earned · AUD");
    expect(weeklyTotal().getByText("$333.00")).toBeTruthy();
    await act(async () => { firstRequest.resolve(makeUserEarnings(date)); });
    expect(weeklyTotal().getByText("$333.00")).toBeTruthy();
    expect(weeklyTotal().queryByText("$265.00")).toBeNull();
    expect((screen.getByLabelText("Select a week") as HTMLSelectElement).value).toBe(previousDate);
  });

  it("shows weekly extras even when there are no daily shift earnings", async () => {
    const response = makeUserEarnings("2026-08-24");
    response.week = makeEarningsWeek("2026-08-24", { wages: 0, fuel: 0, extras: 40, hours: 0, openShiftCount: 0 });
    fetchUserEarnings.mockResolvedValueOnce(response);
    render(<AdminUserEarnings user={ADMIN_TEST_USER} initialDate="2026-08-24" onAuthError={() => false} />);
    await screen.findByText("Total earned · AUD");
    expect(weeklyTotal().getByText("$40.00")).toBeTruthy();
    expect(screen.getByText("No shift earnings recorded this week yet.")).toBeTruthy();
    expect(screen.getByText("0 completed shifts")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Weekly earnings goal" }).getAttribute("aria-valuenow")).toBe("8");
    expect(screen.getAllByRole("button", { name: /\$0\.00 total/i })).toHaveLength(7);
  });
});
