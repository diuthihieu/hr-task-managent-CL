import { expect, test } from "@playwright/test";

test("readiness endpoint reports a reachable database", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: "ok", database: "reachable" });
});

test("signed-out user can reach the authentication landing page", async ({ page }) => {
  await page.goto("/?auth=login#auth");
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator('input[type="email"]')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toBeVisible();
});
