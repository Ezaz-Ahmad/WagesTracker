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
