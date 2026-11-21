import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test.use({ timezoneId: "UTC" });
test("real API preserves multi-job pay, navigation and PDF export", async ({ page, request }, testInfo) => {
  const origin = "http://127.0.0.1:4317";
  const date = new Date().toISOString().slice(0, 10);
  const signup = await request.post(`${origin}/api/auth/signup`, { data: { name: "Quality Review", email: `review-${randomUUID()}@example.com`, password: "Browser-journey-secure-2026!", rate: 30, workLocationName: "City Retail" } });
  expect(signup.status()).toBe(201);
  const { token } = await signup.json();
  const headers = { Authorization: `Bearer ${token}`, "X-Client-Time-Zone": "UTC" };
  const initialJobs = await request.get(`${origin}/api/jobs`, { headers });
  const primaryJob = (await initialJobs.json()).jobs[0];
  const added = await request.post(`${origin}/api/jobs`, { headers, data: { name: "Harbour Hotel", role: "Guest services", rate: 40 } });
  expect(added.status()).toBe(201);
  const secondJob = (await added.json()).job;
  const secondHeaders = { ...headers, "X-Work-Job": secondJob.id };
  for (const [name, rate, signIn, signOut] of [["Harbour East", 46, "17:00", "19:00"], ["Harbour West", 38, "19:00", "21:00"]] as const) {
    const locationResponse = await request.post(`${origin}/api/work-locations`, { headers: secondHeaders, data: { name } });
    expect(locationResponse.status()).toBe(201);
    const location = (await locationResponse.json()).location;
    const rateResponse = await request.post(`${origin}/api/jobs/${secondJob.id}/rates`, { headers, data: { locationId: location.id, rate, effectiveFrom: date } });
    expect(rateResponse.ok(), await rateResponse.text()).toBe(true);
    const shift = await request.post(`${origin}/api/shifts`, { headers: secondHeaders, data: { date, workLocationId: location.id, location: name, signIn, signOut } });
    expect(shift.status(), await shift.text()).toBe(201);
    expect((await shift.json()).shift.appliedRate).toBe(rate);
  }
  const primaryShift = await request.post(`${origin}/api/shifts`, { headers: { ...headers, "X-Work-Job": primaryJob.id }, data: { date, location: "City Retail", signIn: "09:00", signOut: "17:00" } });
  expect(primaryShift.status(), await primaryShift.text()).toBe(201);
  const categories = await request.get(`${origin}/api/spending/categories`, { headers });
  const category = (await categories.json()).categories[0];
  const expense = await request.post(`${origin}/api/spending/expenses`, { headers, data: { amountCents: 1250, categoryId: category.id, spentAt: `${date}T12:00`, merchant: "Private lunch", note: "Personal only", jobId: secondJob.id } });
  expect(expense.status(), await expense.text()).toBe(201);

  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.setFixedTime(new Date(`${date}T12:00:00.000Z`));
  // Every browser API request is relayed only to the isolated loopback API,
  // even if a developer builds with their production API origin configured.
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${origin}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
  await page.addInitScript(value => { localStorage.setItem("wageTracker.token", value); localStorage.setItem("wageTracker.lastActivity", String(Date.now())); }, token);
  await page.goto("/");
  await expect(page.locator(".workspace-trigger")).toContainText("City Retail");
  await expect(page.locator(".week-amount").first()).toContainText("240.00");
  await page.locator(".workspace-trigger").click();
  await page.getByRole("button", { name: /All jobs Combined earnings/ }).click();
  await expect(page.locator(".job-overview-amount")).toContainText("408.00");
  for (const tab of ["Entry", "History", "Report", "Spending", "Settings", "Home"]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.locator(".workspace-trigger")).toHaveCount(tab === "Settings" ? 0 : 1);
    await expect(page.getByText("Something went wrong", { exact: true })).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const exporter = page.getByRole("dialog", { name: "Export wage report" });
  await exporter.getByRole("radio", { name: /Harbour Hotel/ }).check();
  const download = page.waitForEvent("download");
  await exporter.getByRole("button", { name: "Download PDF", exact: true }).click();
  const reportPath = testInfo.outputPath("location-rates.pdf");
  await (await download).saveAs(reportPath);
  await testInfo.attach("Employer report with location rates", { path: reportPath, contentType: "application/pdf" });
  await expect(exporter.getByText("Report prepared successfully.")).toBeVisible();
  expect(errors).toEqual([]);
});
