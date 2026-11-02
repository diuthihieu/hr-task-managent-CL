import { test, expect } from "@playwright/test";

// BUG-06a: the grid renders only the rows in view (+ overscan), whatever the number of tasks.
// Run on a project from scripts/seed-large-project.ts, grouping off, fixed row height.
const OVERSCAN = 10;
const ROWS = '[role="row"][data-record-id]';

test("a 5,000-task project keeps the number of rendered rows bounded while scrolling", async ({ page }) => {
  test.skip(!process.env.PERF_PROJECT_PATH, "needs a seeded database (see playwright.perf.config.ts)");
  const request = page.context().request;
  const { csrfToken } = await (await request.get("/api/auth/csrf")).json();
  await request.post("/api/auth/callback/credentials", { form: { csrfToken, email: process.env.PERF_EMAIL!, password: process.env.PERF_PASSWORD!, callbackUrl: "/" }, maxRedirects: 0 });
  await page.goto(process.env.PERF_PROJECT_PATH!);
  const grid = page.getByTestId("grid-view");
  await expect(grid.locator(ROWS).first()).toBeVisible({ timeout: 60_000 });

  const visible = async () => grid.evaluate((el) => Math.ceil(el.clientHeight / 32));
  const limit = (await visible()) + 2 * OVERSCAN;
  const atTop = await page.locator(ROWS).count();
  await grid.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
  await page.waitForTimeout(500);
  const atBottom = await page.locator(ROWS).count();
  console.log(`rendered rows: top ${atTop}, bottom ${atBottom}, limit ${limit}`);
  expect(atTop).toBeLessThanOrEqual(limit);
  expect(atBottom).toBeLessThanOrEqual(limit);
  await expect(page.locator(ROWS).last()).toBeVisible();
});
