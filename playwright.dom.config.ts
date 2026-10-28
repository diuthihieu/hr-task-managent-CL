import { defineConfig, devices } from "@playwright/test";

// Browser-only checks that need no app server or database (e2e/dom-*.spec.ts):
//   npx playwright test -c playwright.dom.config.ts
// The main config runs the same specs in CI.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /dom-.*\.spec\.ts/,
  reporter: "list",
  projects: [{ name: "dom", use: { ...devices["Desktop Chrome"] } }],
});
