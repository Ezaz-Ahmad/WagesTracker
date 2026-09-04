import { expect, test, type Page } from "@playwright/test";

const USER = {
  id: "smoke-user",
  name: "Production Smoke",
  email: "smoke@example.invalid",
  address: "",
  workLocationName: "",
  workAddress: "",
  multipleLocations: false,
  otherLocations: "",
  weekStartsOn: "Monday",
  rate: 30,
  goalHours: 38,
  goalEarnings: 1_140,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const WORK_LOCATIONS = [
  {
    id: "location-newcastle",
    name: "Newcastle City",
    address: "10 Hunter Street, Newcastle NSW",
    fuelAllowance: 12.5,
    archived: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "location-gosford",
    name: "Gosford",
    address: "25 Mann Street, Gosford NSW",
    fuelAllowance: null,
    archived: false,
    archivedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

async function captureRuntimeErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  // The app's optional Google font is intentionally external. Stub only that
  // stylesheet so an offline/locked-down test runner does not turn a harmless
  // font fallback into a false JavaScript runtime failure.
  await page.route("https://fonts.googleapis.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/css", body: "" })
  );
  page.on("pageerror", (error) => errors.push(error.stack || error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function mockAuthenticatedApi(page: Page, options: { summaryDelayMs?: number; spendingTotalCents?: number } = {}) {
  let summaryRequests = 0;
  let categoryRequests = 0;
  await page.addInitScript(() => {
    localStorage.setItem("wageTracker.token", "production-smoke-token");
    localStorage.setItem("wageTracker.lastActivity", String(Date.now()));
  });

  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let body: unknown;

    if (pathname === "/api/me") body = { user: USER };
    else if (pathname === "/api/me/sessions") body = { sessions: [] };
    else if (pathname === "/api/work-locations") body = { locations: WORK_LOCATIONS };
    else if (pathname === "/api/shifts") body = { shifts: [] };
    else if (pathname === "/api/day-expenses") body = { expenses: [] };
    else if (pathname === "/api/week-extras") body = { extras: [] };
    else if (pathname === "/api/spending/categories") {
      categoryRequests += 1;
      body = { categories: [] };
    }
    else if (pathname === "/api/spending/expenses") {
      body = { expenses: [], page: 1, pageSize: 20, total: 0, hasMore: false };
    } else if (pathname === "/api/spending/summary") {
      summaryRequests += 1;
      if (options.summaryDelayMs) await new Promise((resolve) => setTimeout(resolve, options.summaryDelayMs));
      const spendingTotalCents = options.spendingTotalCents ?? 0;
      body = {
        period: {
          from: "2026-08-01",
          to: "2026-08-31",
          previousFrom: "2026-07-01",
          previousTo: "2026-07-31",
          days: 31,
        },
        earningsCents: 0,
        earningsRecorded: false,
        totalSpendingCents: spendingTotalCents,
        differenceCents: -spendingTotalCents,
        spendingPercentage: null,
        averageDailyCents: 0,
        transactionCount: spendingTotalCents > 0 ? 1 : 0,
        largestCategory: spendingTotalCents > 0
          ? { id: "rent", name: "Rent & housing", icon: "housing", colour: "#7C3AED", totalCents: spendingTotalCents, transactionCount: 1 }
          : null,
        previous: { earningsCents: 0, totalSpendingCents: 0, spendingChangePercent: null },
        categories: spendingTotalCents > 0
          ? [{ id: "rent", name: "Rent & housing", icon: "housing", colour: "#7C3AED", totalCents: spendingTotalCents, transactionCount: 1 }]
          : [],
        trend: [],
        recentExpenses: [],
      };
    } else if (pathname === "/api/health") body = { ok: true };
    else body = {};

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  return {
    summaryRequests: () => summaryRequests,
    categoryRequests: () => categoryRequests,
  };
}

test("desktop cold logged-out bundle mounts a visible login screen", async ({ page }) => {
  const errors = await captureRuntimeErrors(page);

  await page.goto("/");

  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.locator("#root")).not.toBeEmpty();
  await expect(page.locator(".landing-shell")).toBeVisible();
  await expect(page.locator(".welcome-screen")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("mobile cold logged-out bundle shows the welcome flow and reaches login", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await captureRuntimeErrors(page);

  await page.goto("/");

  await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
  await page.getByRole("button", { name: "Get started" }).click();
  await expect(page.getByLabel("Email")).toBeVisible();
  expect(errors).toEqual([]);
});

test("existing authenticated session mounts Home and Spending from the production bundle", async ({ page }) => {
  const errors = await captureRuntimeErrors(page);
  const requests = await mockAuthenticatedApi(page, { summaryDelayMs: 250 });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByLabel("Loading this month's spending")).toBeVisible();
  await expect(page.getByText("Loading this month's spending…")).toHaveCount(0);
  await expect(page.locator(".home-spending-donut")).toBeVisible();
  expect(requests.summaryRequests()).toBe(1);

  await page.getByRole("button", { name: "Spending", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Spending", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This month at a glance" })).toBeVisible();
  await expect(page.locator(".spending-dashboard-skeleton")).toHaveCount(0);
  expect(requests.summaryRequests()).toBe(1);
  expect(requests.categoryRequests()).toBe(1);

  const mainNav = page.getByRole("navigation", { name: "Main" });
  await mainNav.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "History", exact: true })).toBeVisible();
  await mainNav.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.locator(".home-spending-donut")).toBeVisible();
  await expect(page.locator(".home-spending-skeleton")).toHaveCount(0);
  await mainNav.getByRole("button", { name: "Spending", exact: true }).click();
  await expect(page.getByRole("heading", { name: "This month at a glance" })).toBeVisible();
  await expect(page.locator(".spending-dashboard-skeleton")).toHaveCount(0);
  expect(requests.summaryRequests()).toBe(1);
  expect(requests.categoryRequests()).toBe(1);
  expect(errors).toEqual([]);
});

test("mobile production bundle keeps an exact four-figure spending total inside its donut", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const errors = await captureRuntimeErrors(page);
  await mockAuthenticatedApi(page, { spendingTotalCents: 107_356 });

  await page.goto("/");

  const donut = page.locator(".home-spending-donut");
  const center = page.locator(".home-spending-donut-center");
  await expect(donut).toBeVisible();
  await expect(center).toContainText("$1,073.56");
  await expect(center).toHaveClass(/is-medium/);

  const donutBox = await donut.boundingBox();
  const amountBox = await center.locator("strong").boundingBox();
  expect(donutBox).not.toBeNull();
  expect(amountBox).not.toBeNull();
  expect(amountBox!.x).toBeGreaterThanOrEqual(donutBox!.x);
  expect(amountBox!.x + amountBox!.width).toBeLessThanOrEqual(donutBox!.x + donutBox!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  expect(errors).toEqual([]);
});

test("desktop Home uses the polished work-location picker instead of a native select", async ({ page }) => {
  const errors = await captureRuntimeErrors(page);
  await mockAuthenticatedApi(page);

  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Work location: Choose a location" });
  await expect(trigger).toBeVisible();
  await expect(page.locator(".home-clock-location select")).toHaveCount(0);

  await trigger.click();
  const picker = page.getByRole("dialog", { name: "Choose today's work location" });
  await expect(picker).toBeVisible();
  await expect(picker.getByText("10 Hunter Street, Newcastle NSW")).toBeVisible();
  await expect(picker.getByText("$12.50 fuel allowance per worked day")).toBeVisible();
  await picker.getByRole("button", { name: /Newcastle City/ }).click();

  await expect(picker).toBeHidden();
  await expect(page.getByRole("button", { name: "Work location: Newcastle City" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("mobile users can personalise Home and the tab bar, with the layout surviving reload", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await captureRuntimeErrors(page);
  await mockAuthenticatedApi(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
  const mainNav = page.getByRole("navigation", { name: "Main" });
  await mainNav.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /Profile & preferences/ }).click();
  await page.getByRole("button", { name: "Customise app layout" }).click();

  const dialog = page.getByRole("dialog", { name: "Customise your layout" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Move Personal spending up" }).click();
  await dialog.getByRole("button", { name: "Move Personal spending up" }).click();
  await dialog.getByRole("button", { name: "Hide Week summary" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();

  await expect(dialog).toBeHidden();
  await mainNav.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.locator('[data-widget-id="week-summary"]')).toHaveCount(0);
  await expect(page.locator("[data-widget-id]").first()).toHaveAttribute("data-widget-id", "spending");

  await page.reload();
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
  await expect(page.locator('[data-widget-id="week-summary"]')).toHaveCount(0);
  await expect(page.locator("[data-widget-id]").first()).toHaveAttribute("data-widget-id", "spending");

  await mainNav.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /Profile & preferences/ }).click();
  await page.getByRole("button", { name: "Customise app layout" }).click();
  await dialog.getByRole("tab", { name: "Tab bar" }).click();
  await dialog.getByRole("button", { name: "Move Entry up" }).click();
  await dialog.getByRole("button", { name: "Done" }).click();

  const navLabels = await mainNav.getByRole("button").allTextContents();
  expect(navLabels).toEqual(["Entry", "Home", "Spending", "Report", "History", "Settings"]);
  expect(errors).toEqual([]);
});

test("mobile Home opens polished detail sheets for days and summary cards", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await captureRuntimeErrors(page);
  await mockAuthenticatedApi(page);

  await page.goto("/");
  const glance = page.getByRole("group", { name: "Select a day to review this week's details" });
  await glance.getByRole("button").first().click();
  const dayDialog = page.getByRole("dialog");
  await expect(dayDialog.getByText("Day details")).toBeVisible();
  await expect(dayDialog.getByText(/No shift has been logged/)).toBeVisible();
  await dayDialog.getByRole("button", { name: "Done" }).click();
  await expect(dayDialog).toBeHidden();

  await page.getByRole("button", { name: "View Days logged details" }).click();
  const daysDialog = page.getByRole("dialog");
  await expect(daysDialog.getByText("This week")).toBeVisible();
  await daysDialog.getByRole("button", { name: "Done" }).click();
  await expect(daysDialog).toBeHidden();

  await page.getByRole("button", { name: "View Weeks on goal details" }).click();
  const weeksDialog = page.getByRole("dialog");
  await expect(weeksDialog.getByText("Completed weeks")).toBeVisible();
  await weeksDialog.getByRole("button", { name: "Done" }).click();
  await expect(weeksDialog).toBeHidden();

  await page.getByRole("button", { name: "View Current streak details" }).click();
  const streakDialog = page.getByRole("dialog");
  await expect(streakDialog.getByText("Recent streak days")).toBeVisible();
  await streakDialog.getByRole("button", { name: "Done" }).click();
  await expect(streakDialog).toBeHidden();
  expect(errors).toEqual([]);
});
