import { defineConfig, devices } from "@playwright/test";

// `setup` signs up one user and builds a workspace (e2e/global.setup.ts); the phone
// specs run on an iPhone and an Android viewport (both in Chromium, like CI has).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: process.env.CI ? "npm run start" : "npm run dev",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    { name: "chromium", testMatch: /(production-smoke|service-worker)\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    // Browser-only checks (no sign-in); also runnable without a server: playwright.dom.config.ts.
    { name: "dom", testMatch: /dom-.*\.spec\.ts/, use: { ...devices["Desktop Chrome"] } },
    { name: "desktop", testMatch: /(grid|desktop)-.*\.spec\.ts/, dependencies: ["setup"], use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "iphone", testMatch: /mobile-.*\.spec\.ts/, dependencies: ["setup"], use: { ...devices["iPhone 14"], browserName: "chromium" } },
    { name: "android", testMatch: /mobile-.*\.spec\.ts/, dependencies: ["setup"], use: { ...devices["Pixel 7"] } },
  ],
});
