// The phone app shell: landing on "All", the five tabs docked at the bottom, the menu
// button, pinch-zoom locked, and the tabs coming back after typing.
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test.describe("a fresh app session", () => {
  test.use({ landed: false });

  test("opening the workspace lands on All, once", async ({ page, seed }) => {
    await page.goto(`/w/${seed.slug}`);
    await page.waitForURL(/\/apps$/);
    for (const group of ["work", "intelligence", "manage", "knowledge", "projects", "more"]) await expect(page.getByTestId(`all-group-${group}`)).toBeVisible();
    await page.getByTestId("tab-home").click();
    await page.waitForURL(new RegExp(`/w/${seed.slug}$`));
    await expect(page.getByTestId("tab-home")).toHaveAttribute("aria-current", "page");
  });
});

test("five tabs are docked at the bottom and open their screens", async ({ page, seed }) => {
  await page.goto(`/w/${seed.slug}/apps`);
  const bar = page.getByTestId("mobile-tab-bar");
  await expect(bar.locator("a,button")).toHaveCount(5);
  const box = (await bar.boundingBox())!;
  expect(Math.abs(box.y + box.height - page.viewportSize()!.height)).toBeLessThanOrEqual(2);
  await expect(page.getByTestId("tab-all")).toHaveAttribute("aria-current", "page");

  await page.getByTestId("tab-ai").click();
  await page.waitForURL(/\/ai$/);
  await page.getByTestId("tab-recognition").click();
  await page.waitForURL(/\/recognition$/);
  await page.getByTestId("tab-projects").click();
  await page.getByRole("dialog").getByText("Compensation & Benefits and Payroll operations").click();
  await page.waitForURL(new RegExp(`/p/${seed.projectId}`));
});

test("the menu button sits top-left and opens the full menu", async ({ page, seed }) => {
  await page.goto(`/w/${seed.slug}/apps`);
  const menu = page.getByTestId("nav-open");
  const box = (await menu.boundingBox())!;
  expect(box.x).toBeLessThan(40);
  expect(box.y).toBeLessThan(60);
  await menu.click();
  await expect(page.getByTestId("sidebar-mobile-app")).toBeVisible();
});

test("pinch-zoom is locked on the page", async ({ page, seed }) => {
  await page.goto(`/w/${seed.slug}/apps`);
  const viewport = await page.locator("meta[name=viewport]").getAttribute("content");
  expect(viewport).toMatch(/maximum-scale=1/);
  expect(viewport).toMatch(/user-scalable=no/);
  const touch = await page.evaluate(() => getComputedStyle(document.documentElement).touchAction);
  expect(touch).toContain("pan-x");
  expect(touch).toContain("pan-y");
});

test("the tabs come back to the bottom after typing", async ({ page, seed }) => {
  await page.goto(`/w/${seed.slug}/my-work`);
  const input = page.locator("input").first();
  await input.tap();
  await page.keyboard.type("Chuẩn bị báo cáo");
  await page.evaluate(() => window.scrollTo(0, 300)); // what iOS does when the keyboard opens
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect
    .poll(async () => {
      const box = await page.getByTestId("mobile-tab-bar").boundingBox();
      return box ? Math.round(box.y + box.height) : -1;
    })
    .toBe(page.viewportSize()!.height);
});
