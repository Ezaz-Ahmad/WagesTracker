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

async function mockAuthenticatedApi(page: Page): Promise<void> {
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
    else if (pathname === "/api/spending/categories") body = { categories: [] };
    else if (pathname === "/api/spending/expenses") {
      body = { expenses: [], page: 1, pageSize: 20, total: 0, hasMore: false };
    } else if (pathname === "/api/spending/summary") {
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
        totalSpendingCents: 0,
        differenceCents: 0,
        spendingPercentage: null,
        averageDailyCents: 0,
        transactionCount: 0,
        largestCategory: null,
        previous: { earningsCents: 0, totalSpendingCents: 0, spendingChangePercent: null },
        categories: [],
        trend: [],
        recentExpenses: [],
      };
    } else if (pathname === "/api/health") body = { ok: true };
    else body = {};

    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
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
  await mockAuthenticatedApi(page);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();

  await page.getByRole("button", { name: "Spending", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Spending", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This month at a glance" })).toBeVisible();
  expect(errors).toEqual([]);
});
