// On a phone, reopening woli lands on the "All" page of the workspace last open.
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("phone: reopening woli lands on the All page of the workspace last used", async ({ page, seed }) => {
  await page.goto(`/w/${seed.slug}/my-work`);
  await page.goto("/workspaces?source=app");
  await expect(page).toHaveURL(new RegExp(`/w/${seed.slug}/apps$`));
  await page.goto("/");
  await expect(page).toHaveURL(new RegExp(`/w/${seed.slug}/apps$`));
});
