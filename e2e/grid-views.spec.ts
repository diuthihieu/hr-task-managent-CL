// Views and columns of a project on a desktop screen: adding, renaming, duplicating and
// deleting views, and the column menu (sort, hide, freeze, add / delete a custom field).
// Everything is checked through the API too, since the view config is saved in the background.
import type { APIRequestContext, Page } from "@playwright/test";
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

type View = { id: string; name: string; type: string; config: string };
type Detail = { views: View[]; fields: { id: string; name: string; type: string; system?: boolean }[] };

async function project(request: APIRequestContext, wsId: string, titles: string[]) {
  const p = await request.post(`/api/workspaces/${wsId}/projects`, { data: { name: `Views ${Date.now()}-${Math.random().toString(36).slice(2, 6)}` } });
  expect(p.ok()).toBeTruthy();
  const { id } = (await p.json()) as { id: string };
  for (const title of titles) expect((await request.post(`/api/projects/${id}/tasks`, { data: { data: { sys_title: title } } })).ok()).toBeTruthy();
  return id;
}
const detail = async (request: APIRequestContext, id: string) => (await (await request.get(`/api/projects/${id}`)).json()) as Detail;
const config = (v: View | undefined) => JSON.parse(v?.config || "{}") as Record<string, unknown>;
const tab = (page: Page, viewId: string) => page.locator(`[data-testid=view-tab][data-view-id="${viewId}"]`);

test("views: add a Kanban view, rename, duplicate and delete it", async ({ page, seed }) => {
  const id = await project(page.request, seed.wsId, ["Task A"]);
  await page.goto(`/w/${seed.slug}/p/${id}`);
  await expect(page.getByTestId("view-tab")).toHaveCount(1);

  await page.getByTestId("add-view").click();
  await page.getByTestId("add-view-kanban").click();
  await expect(page.getByTestId("view-tab")).toHaveCount(2);
  await expect.poll(async () => (await detail(page.request, id)).views.map((v) => v.type).sort().join(",")).toBe("grid,kanban");
  const kanban = (await detail(page.request, id)).views.find((v) => v.type === "kanban")!;

  await tab(page, kanban.id).getByTestId("view-tab-menu").click();
  await page.getByTestId("view-rename").click();
  await page.getByTestId("view-rename-input").fill("Bảng Kanban HR");
  await page.getByTestId("view-rename-input").press("Enter");
  await expect.poll(async () => (await detail(page.request, id)).views.find((v) => v.id === kanban.id)?.name).toBe("Bảng Kanban HR");

  await tab(page, kanban.id).getByTestId("view-tab-menu").click();
  await page.getByTestId("view-duplicate").click();
  await expect(page.getByTestId("view-tab")).toHaveCount(3);
  await expect.poll(async () => (await detail(page.request, id)).views.length).toBe(3);
  const copy = (await detail(page.request, id)).views.find((v) => v.id !== kanban.id && v.type === "kanban")!;

  page.once("dialog", (d) => void d.accept());
  await tab(page, copy.id).getByTestId("view-tab-menu").click();
  await page.getByTestId("view-delete").click();
  await expect(page.getByTestId("view-tab")).toHaveCount(2);
  await expect.poll(async () => (await detail(page.request, id)).views.length).toBe(2);
});

test("columns: sort, hide, freeze, and add / delete a custom field from the column menu", async ({ page, seed }) => {
  const id = await project(page.request, seed.wsId, ["Alpha", "Bravo", "Charlie"]);
  await page.goto(`/w/${seed.slug}/p/${id}`);
  const rows = page.locator("[data-testid=grid-view] [role=row][data-record-id]");
  await expect(rows).toHaveCount(3);
  const titles = () => rows.locator("[data-field-id=sys_title] textarea, [data-field-id=sys_title] input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  const gridView = async () => (await detail(page.request, id)).views.find((v) => v.type === "grid");
  const menu = async (fieldId: string, action: string) => {
    await page.getByTestId(`field-menu-${fieldId}`).click();
    await page.getByTestId(`field-action-${action}`).click();
  };

  await menu("sys_title", "sort_desc");
  await expect.poll(titles).toEqual(["Charlie", "Bravo", "Alpha"]);
  await expect.poll(async () => config(await gridView()).sorts).toEqual([{ fieldId: "sys_title", direction: "desc" }]);

  await menu("sys_description", "hide");
  await expect(page.getByTestId("field-menu-sys_description")).toHaveCount(0);
  await expect.poll(async () => config(await gridView()).hiddenFieldIds).toEqual(["sys_description"]);

  await menu("sys_status", "freeze");
  await expect.poll(async () => Number(config(await gridView()).frozenCount ?? 0)).toBeGreaterThan(1);
  await expect(rows.first().locator("[data-field-id=sys_status]")).toHaveCSS("position", "sticky");

  // A new custom field opens its settings; it is created right away.
  await page.getByTestId("add-field").click();
  await page.getByTestId("add-field-number").click();
  await expect.poll(async () => (await detail(page.request, id)).fields.filter((f) => !f.system && f.type === "number").length).toBe(1);
  // The settings dialog opens once the screen has reloaded the project: wait for it, then close it.
  const settings = page.getByRole("dialog");
  await expect(settings).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  const custom = (await detail(page.request, id)).fields.find((f) => !f.system && f.type === "number")!;
  await expect(page.getByTestId(`field-menu-${custom.id}`)).toHaveCount(1);

  page.once("dialog", (d) => void d.accept());
  await menu(custom.id, "delete");
  await expect.poll(async () => (await detail(page.request, id)).fields.filter((f) => !f.system).length).toBe(0);
  await expect(page.getByTestId(`field-menu-${custom.id}`)).toHaveCount(0);
});
