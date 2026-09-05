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

async function mockAuthenticatedApi(page: Page, options: {
  summaryDelayMs?: number;
  spendingTotalCents?: number;
  activeShift?: boolean;
  chartData?: boolean;
} = {}) {
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
    else if (pathname === "/api/shifts") {
      const now = new Date();
      const startedAt = new Date(now.getTime() - 75 * 60 * 1000);
      const dateString = (value: Date) => [value.getFullYear(), value.getMonth() + 1, value.getDate()]
        .map((part, index) => String(part).padStart(index === 0 ? 4 : 2, "0"))
        .join("-");
      const date = dateString(now);
      const signIn = [startedAt.getHours(), startedAt.getMinutes(), startedAt.getSeconds()]
        .map((part) => String(part).padStart(2, "0"))
        .join(":");
      const completedShifts = options.chartData
        ? [2, 8, 15, 22, 29, 36].map((daysAgo, index) => {
          const shiftDate = new Date(now);
          shiftDate.setDate(now.getDate() - daysAgo);
          return {
            id: `chart-shift-${index}`,
            date: dateString(shiftDate),
            location: index % 2 ? "Gosford" : "Newcastle City",
            signIn: "09:00:00",
            signOut: index % 2 ? "16:30:00" : "17:00:00",
          };
        })
        : [];
      body = {
        shifts: [
          ...completedShifts,
          ...(options.activeShift
            ? [{ id: "active-shift", date, location: "Newcastle City", signIn, signOut: null }]
            : []),
        ],
      };
    }
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
      const spendingTotalCents = options.spendingTotalCents ?? (options.chartData ? 78_000 : 0);
      const earningsCents = options.chartData ? 220_000 : 0;
      body = {
        period: {
          from: "2026-08-01",
          to: "2026-08-31",
          previousFrom: "2026-07-01",
          previousTo: "2026-07-31",
          days: 31,
        },
        earningsCents,
        earningsRecorded: options.chartData === true,
        totalSpendingCents: spendingTotalCents,
        differenceCents: earningsCents - spendingTotalCents,
        spendingPercentage: earningsCents ? (spendingTotalCents / earningsCents) * 100 : null,
        averageDailyCents: options.chartData ? 2_516 : 0,
        transactionCount: options.chartData ? 4 : spendingTotalCents > 0 ? 1 : 0,
        largestCategory: spendingTotalCents > 0
          ? { id: "rent", name: "Rent & housing", icon: "housing", colour: "#7C3AED", totalCents: spendingTotalCents, transactionCount: 1 }
          : null,
        previous: { earningsCents: 190_000, totalSpendingCents: 69_000, spendingChangePercent: 13.04 },
        categories: options.chartData
          ? [
            { id: "rent", name: "Rent & housing", icon: "housing", colour: "#7C3AED", totalCents: 50_000, transactionCount: 1 },
            { id: "food", name: "Food & dining", icon: "food", colour: "#1D4ED8", totalCents: 28_000, transactionCount: 3 },
          ]
          : spendingTotalCents > 0
            ? [{ id: "rent", name: "Rent & housing", icon: "housing", colour: "#7C3AED", totalCents: spendingTotalCents, transactionCount: 1 }]
          : [],
        trend: options.chartData
          ? [
            { date: "2026-08-03", totalCents: 12_000 },
            { date: "2026-08-10", totalCents: 21_000 },
            { date: "2026-08-17", totalCents: 18_000 },
            { date: "2026-08-24", totalCents: 27_000 },
          ]
          : [],
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

async function captureChartAnimationStarts(page: Page) {
  await page.addInitScript(() => {
    const trackedWindow = window as Window & { __chartAnimationStarts: string[] };
    trackedWindow.__chartAnimationStarts = [];
    document.addEventListener("animationstart", (event) => {
      if (!(event instanceof AnimationEvent)) return;
      if (["draw-line", "donut-segment-reveal"].includes(event.animationName)) {
        trackedWindow.__chartAnimationStarts.push(event.animationName);
      }
    }, true);
  });
}

async function chartAnimationCount(page: Page, name: string): Promise<number> {
  return page.evaluate((animationName) => {
    const starts = (window as Window & { __chartAnimationStarts?: string[] }).__chartAnimationStarts ?? [];
    return starts.filter((item) => item === animationName).length;
  }, name);
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

test("appearance choices apply immediately, follow the device and survive reload", async ({ page }) => {
  const errors = await captureRuntimeErrors(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    if (!localStorage.getItem("wagesTracker.theme.preference.v1")) {
      localStorage.setItem("wagesTracker.theme.preference.v1", "dark");
    }
  });
  await mockAuthenticatedApi(page);

  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#000000");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(0, 0, 0)");
  await expect(page.locator(".card").first()).toHaveCSS("background-color", "rgb(17, 17, 19)");

  const mainNav = page.getByRole("navigation", { name: "Main" });
  await mainNav.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /Profile & preferences/ }).click();
  await expect(page.getByRole("radio", { name: /Dark\./ })).toBeChecked();
  const nameInput = page.locator("#settings-name");
  await expect(nameInput).toHaveCSS("background-color", "rgb(28, 28, 31)");
  await nameInput.focus();
  await expect(nameInput).toHaveCSS("border-top-color", "rgb(255, 101, 78)");

  await page.getByRole("radio", { name: /Light\./ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  await mainNav.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: /Profile & preferences/ }).click();
  await page.getByRole("radio", { name: /System\./ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(errors).toEqual([]);
});

test("chart reveals replay smoothly whenever Report and Spending are revisited", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const errors = await captureRuntimeErrors(page);
  await captureChartAnimationStarts(page);
  await page.addInitScript(() => localStorage.setItem("wagesTracker.theme.preference.v1", "dark"));
  await mockAuthenticatedApi(page, { chartData: true });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveClass(/is-entered/);
  await expect(page.locator(".app-shell")).toHaveCSS("opacity", "1");
  const mainNav = page.getByRole("navigation", { name: "Main" });

  await mainNav.getByRole("button", { name: "Report", exact: true }).click();
  const firstTrendLine = page.locator(".chart-line-draw");
  await expect(firstTrendLine).toBeVisible();
  await expect.poll(() => chartAnimationCount(page, "draw-line")).toBeGreaterThan(0);
  const lineTiming = await firstTrendLine.evaluate((element) => {
    const animation = element.getAnimations()[0];
    const timing = animation?.effect?.getTiming();
    return {
      duration: Number(timing?.duration),
      delay: Number(timing?.delay),
    };
  });
  expect(lineTiming.duration).toBeGreaterThanOrEqual(700);
  expect(lineTiming.duration).toBeLessThanOrEqual(1_100);
  expect(lineTiming.delay).toBeGreaterThanOrEqual(100);
  expect(lineTiming.delay).toBeLessThanOrEqual(200);
  expect(lineTiming.duration + lineTiming.delay).toBeLessThanOrEqual(1_200);
  const firstReportCount = await chartAnimationCount(page, "draw-line");

  await mainNav.getByRole("button", { name: "Home", exact: true }).click();
  await mainNav.getByRole("button", { name: "Report", exact: true }).click();
  await expect(page.locator(".chart-line-draw")).toBeVisible();
  await expect.poll(() => chartAnimationCount(page, "draw-line")).toBeGreaterThan(firstReportCount);

  await mainNav.getByRole("button", { name: "Spending", exact: true }).click();
  const spendingDonut = page.locator(".spending-donut");
  await spendingDonut.scrollIntoViewIfNeeded();
  await expect(spendingDonut).toBeVisible();
  await expect.poll(() => chartAnimationCount(page, "donut-segment-reveal")).toBeGreaterThan(0);
  const firstSpendingCount = await chartAnimationCount(page, "donut-segment-reveal");

  await mainNav.getByRole("button", { name: "Home", exact: true }).click();
  await mainNav.getByRole("button", { name: "Spending", exact: true }).click();
  await page.locator(".spending-donut").scrollIntoViewIfNeeded();
  await expect.poll(() => chartAnimationCount(page, "donut-segment-reveal")).toBeGreaterThan(firstSpendingCount);
  expect(errors).toEqual([]);
});

test("desktop Weekly Trend stays compact and supports precise pointer and keyboard inspection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const errors = await captureRuntimeErrors(page);
  await mockAuthenticatedApi(page, { chartData: true });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Report", exact: true }).click();

  const trendCard = page.locator(".report-trend-card");
  const trendVisual = trendCard.locator(".report-trend-visual");
  const trendPlot = trendCard.locator(".report-trend-plot");
  const pointTargets = trendCard.locator("[data-chart-point]");
  const valueLabels = trendCard.locator("[data-chart-value]");
  const fullValueLabels = trendCard.locator(".report-chart-value-full:visible");
  await expect(trendVisual).toBeVisible();
  await expect(pointTargets).toHaveCount(8);
  await expect(valueLabels).toHaveCount(8);
  await expect(fullValueLabels).toHaveCount(8);
  await expect.poll(() => fullValueLabels.allTextContents()).toEqual(Array(8).fill("***"));
  await expect.poll(() => valueLabels.evaluateAll((labels) => labels.map((label) => label.getAttribute("data-value-privacy"))))
    .toEqual(Array(8).fill("hidden"));

  await trendCard.locator("label.seg-opt").filter({ hasText: "Hours" }).click();
  await expect.poll(() => fullValueLabels.allTextContents()).toEqual(expect.arrayContaining([
    expect.stringMatching(/^\d+\.\d{2}h$/),
  ]));
  for (const label of await fullValueLabels.allTextContents()) {
    expect(label).toMatch(/^\d+\.\d{2}h$/);
  }
  await expect.poll(() => valueLabels.evaluateAll((labels) => labels.map((label) => label.getAttribute("data-value-privacy"))))
    .toEqual(Array(8).fill("visible"));

  await trendCard.locator("label.seg-opt").filter({ hasText: "Earnings" }).click();
  await expect.poll(() => fullValueLabels.allTextContents()).toEqual(Array(8).fill("***"));
  await page.getByRole("button", { name: "Show earnings for 20 minutes" }).click();
  await expect.poll(() => fullValueLabels.allTextContents()).toEqual(expect.arrayContaining([
    expect.stringMatching(/^\$\d+\.\d{2}$/),
  ]));
  for (const label of await fullValueLabels.allTextContents()) {
    expect(label).toMatch(/^\$\d+\.\d{2}$/);
  }
  await expect.poll(() => valueLabels.evaluateAll((labels) => labels.map((label) => label.getAttribute("data-value-privacy"))))
    .toEqual(Array(8).fill("visible"));

  const visualBox = await trendVisual.boundingBox();
  const plotBox = await trendPlot.boundingBox();
  expect(visualBox).not.toBeNull();
  expect(plotBox).not.toBeNull();
  expect(visualBox!.width).toBeLessThanOrEqual(721);
  expect(plotBox!.height).toBeLessThan(300);
  expect(plotBox!.width / plotBox!.height).toBeCloseTo(320 / 124, 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  expect(await page.locator(".app-main").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);

  const targetSizes = await pointTargets.evaluateAll((targets) => targets.map((target) => {
    const rect = target.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }));
  for (const size of targetSizes) {
    expect(size.width).toBeGreaterThanOrEqual(44);
    expect(size.height).toBeGreaterThanOrEqual(44);
  }

  const alignmentOffsets = await pointTargets.evaluateAll((targets) => targets.map((target) => {
    const index = target.getAttribute("data-chart-point");
    const dot = document.querySelector(`[data-chart-point-dot="${index}"]`);
    if (!dot) return { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };
    const targetRect = target.getBoundingClientRect();
    const dotRect = dot.getBoundingClientRect();
    return {
      x: Math.abs(targetRect.left + targetRect.width / 2 - (dotRect.left + dotRect.width / 2)),
      y: Math.abs(targetRect.top + targetRect.height / 2 - (dotRect.top + dotRect.height / 2)),
    };
  }));
  for (const offset of alignmentOffsets) {
    expect(offset.x).toBeLessThanOrEqual(1.5);
    expect(offset.y).toBeLessThanOrEqual(1.5);
  }

  const valueLabelBoxes = await fullValueLabels.evaluateAll((labels) => labels.map((label) => {
    const rect = label.parentElement!.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }));
  for (const box of valueLabelBoxes) {
    expect(box.left).toBeGreaterThanOrEqual(visualBox!.x - 0.5);
    expect(box.right).toBeLessThanOrEqual(visualBox!.x + visualBox!.width + 0.5);
    expect(box.top).toBeGreaterThanOrEqual(visualBox!.y - 0.5);
    expect(box.bottom).toBeLessThanOrEqual(visualBox!.y + visualBox!.height + 0.5);
  }
  for (let index = 0; index < valueLabelBoxes.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < valueLabelBoxes.length; otherIndex += 1) {
      const first = valueLabelBoxes[index];
      const second = valueLabelBoxes[otherIndex];
      const overlapWidth = Math.min(first.right, second.right) - Math.max(first.left, second.left);
      const overlapHeight = Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top);
      expect(overlapWidth > 0.5 && overlapHeight > 0.5).toBe(false);
    }
  }
  const inspectedPoint = pointTargets.nth(2);
  await inspectedPoint.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Selected week");
  await expect(tooltip).toContainText("Vs prior week");
  await expect(tooltip).toContainText("Weekly target");
  await expect(tooltip).toContainText(/\$\d|\d+\.\d{2}h/);
  await inspectedPoint.click();
  await page.mouse.move(0, 0);
  await expect(tooltip).toBeVisible();
  await expect(inspectedPoint).toHaveAttribute("aria-pressed", "true");

  await inspectedPoint.focus();
  await inspectedPoint.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(trendCard.locator(".report-trend-inspector")).toHaveClass(/is-idle/);
  expect(errors).toEqual([]);
});

test("mobile Weekly Trend uses compact private-safe point labels without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const errors = await captureRuntimeErrors(page);
  await mockAuthenticatedApi(page, { chartData: true });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Report", exact: true }).click();

  const trendCard = page.locator(".report-trend-card");
  const trendVisual = trendCard.locator(".report-trend-visual");
  const valueLabels = trendCard.locator("[data-chart-value]");
  const compactValueLabels = trendCard.locator(".report-chart-value-compact:visible");
  await expect(trendVisual).toBeVisible();
  await expect(valueLabels).toHaveCount(8);
  await expect(compactValueLabels).toHaveCount(8);
  await expect.poll(() => compactValueLabels.allTextContents()).toEqual(Array(8).fill("***"));
  await expect.poll(() => valueLabels.evaluateAll((labels) => labels.map((label) => label.getAttribute("data-value-privacy"))))
    .toEqual(Array(8).fill("hidden"));

  await trendCard.locator("label.seg-opt").filter({ hasText: "Hours" }).click();
  await expect.poll(() => compactValueLabels.allTextContents()).toEqual(expect.arrayContaining([
    expect.stringMatching(/^\d+(?:\.\d)?h$/),
  ]));
  for (const label of await compactValueLabels.allTextContents()) {
    expect(label).toMatch(/^\d+(?:\.\d)?h$/);
  }

  await trendCard.locator("label.seg-opt").filter({ hasText: "Earnings" }).click();
  await expect.poll(() => compactValueLabels.allTextContents()).toEqual(Array(8).fill("***"));
  await page.getByRole("button", { name: "Show earnings for 20 minutes" }).click();
  await expect.poll(() => compactValueLabels.allTextContents()).toEqual(expect.arrayContaining([
    expect.stringMatching(/^\$\d+(?:\.\d)?[km]?$/),
  ]));
  for (const label of await compactValueLabels.allTextContents()) {
    expect(label).toMatch(/^\$\d+(?:\.\d)?[km]?$/);
  }

  const visualBox = await trendVisual.boundingBox();
  expect(visualBox).not.toBeNull();
  const labelBoxes = await valueLabels.evaluateAll((labels) => labels.map((label) => {
    const rect = label.getBoundingClientRect();
    return { left: rect.left, right: rect.right };
  }));
  for (const box of labelBoxes) {
    expect(box.left).toBeGreaterThanOrEqual(visualBox!.x - 0.5);
    expect(box.right).toBeLessThanOrEqual(visualBox!.x + visualBox!.width + 0.5);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(errors).toEqual([]);
});

test("reduced motion presents chart data immediately without a visible reveal", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors = await captureRuntimeErrors(page);
  await mockAuthenticatedApi(page, { chartData: true });

  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "Report", exact: true }).click();
  const trendLine = page.locator(".chart-line-draw");
  await expect(trendLine).toBeVisible();
  const accessibleTrendData = page.getByRole("table", { name: "Weekly earnings, oldest first" }).first();
  await expect(accessibleTrendData).toContainText(/Hidden|\$/);
  const durationsMs = await trendLine.evaluate((element) => getComputedStyle(element).animationDuration
    .split(",")
    .map((duration) => duration.trim().endsWith("ms")
      ? Number.parseFloat(duration)
      : Number.parseFloat(duration) * 1000));
  expect(durationsMs.every((duration) => duration <= 1)).toBe(true);
  expect(errors).toEqual([]);
});

test("active shift presents a compact live status without disturbing the Home layout", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await captureRuntimeErrors(page);
  await page.addInitScript(() => localStorage.setItem("wagesTracker.theme.preference.v1", "dark"));
  await mockAuthenticatedApi(page, { activeShift: true });

  await page.goto("/");
  const activeCard = page.locator(".home-shift-card.is-active");
  await expect(activeCard).toBeVisible();
  await expect(activeCard.locator(".active-shift-status-badge")).toHaveText("Active");
  await expect(activeCard.getByText(/Started .*Newcastle City/)).toBeVisible();
  await expect(activeCard.locator(".elapsed-timer")).toHaveText(/\d{2}:\d{2}:\d{2}/);
  await expect(activeCard.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.locator(".live-data-badge.is-active")).toHaveCount(1);
  const activeBorder = await activeCard.evaluate((element) => getComputedStyle(element).borderTopColor);
  const genericBorder = await page.locator(".card:not(.is-active)").first().evaluate((element) => getComputedStyle(element).borderTopColor);
  expect(activeBorder).not.toBe(genericBorder);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
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
