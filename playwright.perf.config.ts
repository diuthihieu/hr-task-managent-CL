import { defineConfig, devices } from "@playwright/test";

// Performance checks against a running app whose database was filled by scripts/seed-large-project.ts
// (BUG-06a). Not part of CI. Start the app (npm run build && npm start, pointing at that database), then:
//   PERF_BASE_URL=http://127.0.0.1:3000 PERF_EMAIL=... PERF_PASSWORD=... PERF_PROJECT_PATH=/w/<slug>/p/<id> \
//     npx playwright test -c playwright.perf.config.ts
export default defineConfig({
  testDir: "./e2e",
  testMatch: /\.perf\.ts$/,
  reporter: "list",
  timeout: 120_000,
  use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL: process.env.PERF_BASE_URL ?? "http://127.0.0.1:3000" },
});
