import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: "node --import tsx test/browserServer.ts",
    cwd: "../backend",
    url: "http://127.0.0.1:4317/api/health",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
    },
    {
      name: "webkit-iphone",
      testMatch: "**/real-api-journey.spec.ts",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
});
