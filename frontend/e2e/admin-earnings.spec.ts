import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

const CURRENT_WEEK = "2026-10-19";
const PREVIOUS_WEEK = "2026-10-12";
const EMPTY_WEEK = "2026-10-05";
const REVIEW_DIRECTORY = fileURLToPath(new URL("../../output/admin-earnings-review/", import.meta.url));
const USER = {
  id: "admin-long-user",
  name: "Long Test User",
  email: "long.test.user.with.a.long.address@example.com",
  address: "14 Hunter Street, Newcastle NSW",
  workLocationName: "Newcastle City and Lake Macquarie",
  workAddress: "20 Hunter Street, Newcastle NSW",
  multipleLocations: true,
  otherLocations: "Gosford",
  weekStartsOn: "Monday",
  rate: 32,
  goalHours: 35,
  goalEarnings: 1_120,
  createdAt: "2026-06-01T00:00:00.000Z",
};

function addDays(date: string, offset: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
}

function weekStart(date: string, sunday = false) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return addDays(date, -((day + (sunday ? 0 : 6)) % 7));
}

function earningsWeek(start: string, zero = false) {
  const current = !zero && start === CURRENT_WEEK;
  const previous = !zero && start === PREVIOUS_WEEK;
  const dayHours = current ? [8, 7.5, 0, 4.25, 6, 0, 0] : previous ? [7, 6, 6, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0];
  const dayFuel = current ? [12.5, 15, 0, 0, 12.5, 0, 0] : previous ? [10, 10, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0, 0];
  const days = dayHours.map((hours, index) => ({
    date: addDays(start, index),
    hours,
    wages: hours * USER.rate,
    fuel: dayFuel[index],
    total: hours * USER.rate + dayFuel[index],
    shiftCount: hours > 0 || current && index === 2 ? 1 : 0,
    openShiftCount: current && index === 2 ? 1 : 0,
  }));
  const hours = days.reduce((sum, day) => sum + day.hours, 0);
  const fuel = days.reduce((sum, day) => sum + day.fuel, 0);
  const extras = current ? 43.75 : previous ? 25 : 0;
  return {
    weekStart: start,
    weekEnd: addDays(start, 6),
    hours,
    wages: hours * USER.rate,
    fuel,
    extras,
    total: hours * USER.rate + fuel + extras,
    shiftCount: days.reduce((sum, day) => sum + day.shiftCount, 0),
    completedShiftCount: days.filter((day) => day.hours > 0).length,
    openShiftCount: current ? 1 : 0,
    days,
  };
}

async function mockAdmin(page: Page, theme: "light" | "dark" = "light") {
  const state = { failAccounts: false, failEarnings: false };
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.stack || error.message));
  await page.clock.setFixedTime(new Date("2026-10-24T01:00:00Z"));
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((preference) => {
    localStorage.setItem("wageTracker.adminToken", "admin-earnings-smoke-token");
    localStorage.setItem("wagesTracker.theme.preference.v1", preference);
  }, theme);
  await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
  await page.route("**/api/admin/**", async (route) => {
    const url = new URL(route.request().url());
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-allow-methods": "GET, OPTIONS",
    };
    if (route.request().method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
      return;
    }
    expect(route.request().headers().authorization).toBe("Bearer admin-earnings-smoke-token");
    const anchor = url.searchParams.get("date") ?? "2026-10-24";
    const selected = weekStart(anchor);
    let body: unknown;
    if (url.pathname === "/api/admin/users") {
      if (state.failAccounts) {
        await route.fulfill({ status: 503, headers, json: { error: "Accounts are temporarily unavailable" } });
        return;
      }
      const zeroStart = weekStart(anchor, true);
      body = { users: [
        { ...USER, shiftCount: 42, earnings: earningsWeek(selected), previousEarnings: earningsWeek(addDays(selected, -7)) },
        { ...USER, id: "admin-zero-user", name: "Casey Zero", email: "casey@example.com", weekStartsOn: "Sunday", shiftCount: 0, earnings: earningsWeek(zeroStart, true), previousEarnings: earningsWeek(addDays(zeroStart, -7), true) },
      ] };
    } else if (url.pathname === `/api/admin/users/${USER.id}/earnings`) {
      if (state.failEarnings) {
        await route.fulfill({ status: 503, headers, json: { error: "Weekly earnings are temporarily unavailable" } });
        return;
      }
      body = { week: earningsWeek(selected), previousWeek: earningsWeek(addDays(selected, -7)), availableWeeks: [CURRENT_WEEK, PREVIOUS_WEEK, EMPTY_WEEK] };
    } else if (url.pathname === `/api/admin/users/${USER.id}`) {
      body = { user: USER, shifts: [
        { id: "completed-shift", date: CURRENT_WEEK, location: "Newcastle City", signIn: "09:00", signOut: "17:00" },
        { id: "open-shift", date: addDays(CURRENT_WEEK, 2), location: "Gosford", signIn: "10:00", signOut: null },
      ] };
    } else {
      await route.fulfill({ status: 404, headers, json: { error: "Unknown mocked admin route" } });
      return;
    }
    await route.fulfill({ status: 200, headers, json: body });
  });
  return { state, runtimeErrors };
}

async function expectNoDocumentOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
}

async function screenshot(page: Page, filename: string, fullPage = true) {
  await mkdir(REVIEW_DIRECTORY, { recursive: true });
  await page.screenshot({ path: `${REVIEW_DIRECTORY}/${filename}`, fullPage, animations: "disabled" });
}

test.describe("production admin earnings dashboard", () => {
  test.use({ timezoneId: "Australia/Sydney" });

  for (const display of [
    { name: "desktop", width: 1440, height: 1000, theme: "light" },
    { name: "mobile", width: 390, height: 844, theme: "dark" },
    { name: "narrow mobile", width: 320, height: 740, theme: "light" },
  ] as const) {
    test(`${display.name} supports overview, daily charts, historical weeks and account tools`, async ({ page }) => {
      await page.setViewportSize({ width: display.width, height: display.height });
      const { runtimeErrors } = await mockAdmin(page, display.theme);
      await page.goto("/admin");
      await expect(page.getByRole("heading", { name: "Admin dashboard", level: 1 })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", display.theme);
      await expect(page.getByRole("button", { name: "View Long Test User" })).toBeVisible();
      const userRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: "View Long Test User" }) });
      await expect(userRow).toContainText("$907.75");
      await expect(userRow).toContainText("$653.00");
      const miniChart = page.getByRole("img", { name: /Long Test User daily earnings/ });
      await miniChart.scrollIntoViewIfNeeded();
      await expect(miniChart).toHaveClass(/is-chart-visible/);
      const firstPositiveBar = miniChart.locator(".admin-earnings-chart-stack").first();
      // A chart can have an accessible box while its reveal transform still
      // hides every bar. Verify the actual painted geometry after scrolling.
      await expect.poll(() => firstPositiveBar.evaluate((bar) => bar.getBoundingClientRect().height)).toBeGreaterThan(20);
      await page.getByRole("img", { name: /Casey Zero daily earnings/ }).scrollIntoViewIfNeeded();
      await expect(page.getByRole("img", { name: /Casey Zero daily earnings/ })).toHaveClass(/is-chart-visible/);
      await page.evaluate(() => window.scrollTo(0, 0));
      if (display.width <= 390) {
        await expect.poll(() => page.locator(".admin-frame").evaluate((frame) => parseFloat(getComputedStyle(frame).paddingLeft))).toBeGreaterThan(0);
      }
      await expectNoDocumentOverflow(page);
      if (display.name !== "narrow mobile") await screenshot(page, `${display.name}.png`);

      await page.getByRole("button", { name: "Previous overview week" }).click();
      await expect(page.getByText("Historical overview", { exact: true })).toBeVisible();
      await expect(userRow).toContainText("19.00 hrs");
      await page.getByRole("button", { name: "This week", exact: true }).click();
      await expect(userRow).toContainText("25.75 hrs");
      await page.getByRole("searchbox", { name: "Search users" }).fill("Long Test");
      await expect(page.getByRole("button", { name: "View Casey Zero" })).toHaveCount(0);
      await page.getByRole("button", { name: "View Long Test User" }).click();

      const dialog = page.getByRole("dialog", { name: USER.name });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator(".admin-earned-total")).toHaveText("$907.75");
      await expect(dialog.getByText("Weekly extras", { exact: true })).toBeVisible();
      await expect(dialog.getByRole("progressbar", { name: "Weekly earnings goal" })).toHaveAttribute("aria-valuetext", "$907.75 of $1,120.00");
      const chartDays = dialog.getByRole("group", { name: "Daily earnings by day" }).getByRole("button");
      await expect(chartDays).toHaveCount(7);
      await chartDays.nth(2).click();
      await expect(chartDays.nth(2)).toHaveAttribute("aria-pressed", "true");
      await expect(dialog.getByText("1 open shift · Earnings are still in progress.", { exact: true })).toBeVisible();
      await chartDays.nth(2).focus();
      await page.keyboard.press("ArrowRight");
      await expect(chartDays.nth(3)).toBeFocused();
      await expect(chartDays.nth(3)).toHaveAttribute("aria-pressed", "true");
      await expectNoDocumentOverflow(page);
      if (display.name !== "narrow mobile") await screenshot(page, `${display.name}-detail.png`, false);

      await dialog.getByText("View daily figures", { exact: true }).click();
      await expect(dialog.getByRole("table", { name: "Daily earnings: exact daily shift figures" })).toBeVisible();
      await expectNoDocumentOverflow(page);
      await dialog.getByRole("button", { name: "Previous earnings week" }).click();
      await expect(dialog.getByLabel("Select a week")).toHaveValue(PREVIOUS_WEEK);
      await expect(dialog.locator(".admin-earned-total")).toHaveText("$653.00");
      await dialog.getByLabel("Select a week").selectOption(EMPTY_WEEK);
      await expect(dialog.locator(".admin-earned-total")).toHaveText("$0.00");
      await expect(dialog.getByText("No shift earnings recorded this week yet.")).toBeVisible();
      await expectNoDocumentOverflow(page);
      await dialog.getByRole("button", { name: "This week", exact: true }).click();
      await expect(dialog.locator(".admin-earned-total")).toHaveText("$907.75");

      await dialog.getByRole("button", { name: "Account & shifts", exact: true }).click();
      await expect(dialog.getByRole("heading", { name: "Shift history" })).toBeVisible();
      await expect(dialog.getByLabel("Email", { exact: true })).toHaveValue(USER.email);
      await expect(dialog.getByRole("button", { name: "Update email", exact: true })).toBeDisabled();
      await expect(dialog.getByText("Newcastle City", { exact: true })).toBeVisible();
      await expectNoDocumentOverflow(page);
      await dialog.getByRole("button", { name: "Close user details" }).click();
      await expect(dialog).toHaveCount(0);
      await expectNoDocumentOverflow(page);
      expect(runtimeErrors).toEqual([]);
    });
  }

  test("recovers from account and weekly earnings failures through their retry controls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { state, runtimeErrors } = await mockAdmin(page);
    state.failAccounts = true;
    await page.goto("/admin");
    await expect(page.getByRole("button", { name: "Retry accounts" })).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "Review and fix" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    state.failAccounts = false;
    await page.getByRole("button", { name: "Retry accounts" }).click();
    await expect(page.getByRole("button", { name: "View Long Test User" })).toBeVisible();

    state.failEarnings = true;
    await page.getByRole("button", { name: "View Long Test User" }).click();
    const dialog = page.getByRole("dialog", { name: USER.name });
    await expect(dialog.getByRole("button", { name: "Retry earnings" })).toBeVisible();
    await page.getByRole("alertdialog").getByRole("button", { name: "Review and fix" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    state.failEarnings = false;
    await dialog.getByRole("button", { name: "Retry earnings" }).click();
    await expect(dialog.locator(".admin-earned-total")).toHaveText("$907.75");
    await expectNoDocumentOverflow(page);
    expect(runtimeErrors).toEqual([]);
  });
});
