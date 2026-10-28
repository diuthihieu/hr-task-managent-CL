// The workspace sidebar on a desktop screen: nav links, the compact mode it remembers,
// and a project's view list.
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("nav links open their screens", async ({ page, seed }) => {
  await page.goto(`/w/${seed.slug}`);
  const sidebar = page.getByTestId("sidebar");
  await sidebar.getByTestId("nav-inbox").click();
  await page.waitForURL(/\/inbox$/);
  await sidebar.getByTestId("nav-settings").click();
  await page.waitForURL(/\/settings/);
  await sidebar.getByTestId("nav-home").click();
  await page.waitForURL(new RegExp(`/w/${seed.slug}$`));
});

test("compact mode is remembered after a reload", async ({ page, seed }) => {
  await page.goto(`/w/${seed.slug}`);
  const sidebar = page.getByTestId("sidebar");
  const wide = (await sidebar.boundingBox())!.width;
  await page.getByTestId("sidebar-compact").click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(wide);
  await page.reload();
  await expect.poll(async () => (await page.getByTestId("sidebar").boundingBox())!.width).toBeLessThan(wide);
  await page.getByTestId("sidebar-compact").click();
  await expect.poll(async () => (await page.getByTestId("sidebar").boundingBox())!.width).toBe(wide);
});

test("a project's views are listed in the sidebar and open from there", async ({ page, seed }) => {
  const p = (await (await page.request.post(`/api/workspaces/${seed.wsId}/projects`, { data: { name: `Sidebar ${Date.now()}` } })).json()) as { id: string };
  const v = (await (await page.request.post(`/api/projects/${p.id}/views`, { data: { name: "Lịch tuyển dụng", type: "calendar" } })).json()) as { id: string };
  await page.goto(`/w/${seed.slug}/p/${p.id}`);
  const list = page.getByTestId("sidebar");
  await expect(list.getByTestId(`sidebar-views-${p.id}`)).toBeVisible();
  await list.getByText("Lịch tuyển dụng").click();
  await page.waitForURL(new RegExp(`view=${v.id}`));
  await expect(list.getByTestId(`sidebar-settings-${p.id}`)).toBeVisible();
});
