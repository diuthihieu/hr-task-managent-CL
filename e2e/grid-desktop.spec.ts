// The task grid on a desktop screen: editing cells, sub-tasks, inserting and deleting rows,
// the side panel and the frozen name column. A safety net for refactoring the grid.
import type { APIRequestContext, Page } from "@playwright/test";
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

type Rec = { id: string; data: Record<string, unknown> };

/** A fresh project per test, so tests can run in parallel without seeing each other's rows. */
async function project(request: APIRequestContext, wsId: string, titles: string[]) {
  const p = await request.post(`/api/workspaces/${wsId}/projects`, { data: { name: `Grid ${Date.now()}-${Math.random().toString(36).slice(2, 6)}` } });
  expect(p.ok()).toBeTruthy();
  const { id } = (await p.json()) as { id: string };
  const tasks: Rec[] = [];
  for (const title of titles) tasks.push((await (await request.post(`/api/projects/${id}/tasks`, { data: { data: { sys_title: title } } })).json()) as Rec);
  return { id, tasks };
}
const records = async (request: APIRequestContext, projectId: string) => (await (await request.get(`/api/projects/${projectId}/tasks`)).json()) as Rec[];
const row = (page: Page, id: string) => page.locator(`[role=row][data-record-id="${id}"]`);
const rows = (page: Page) => page.locator("[data-testid=grid-view] [role=row][data-record-id]");

async function open(page: Page, slug: string, projectId: string, count: number) {
  await page.goto(`/w/${slug}/p/${projectId}`);
  await expect(rows(page)).toHaveCount(count);
}

test("editing a title cell saves it", async ({ page, seed }) => {
  const p = await project(page.request, seed.wsId, ["Lập bảng lương tháng 10"]);
  await open(page, seed.slug, p.id, 1);
  const input = row(page, p.tasks[0].id).locator("[data-field-id=sys_title] textarea, [data-field-id=sys_title] input").first();
  await input.click();
  await input.fill("Lập bảng lương tháng 11");
  await input.press("Enter");
  await expect.poll(async () => (await records(page.request, p.id))[0].data.sys_title).toBe("Lập bảng lương tháng 11");
  await page.reload();
  await expect(row(page, p.tasks[0].id).locator("[data-field-id=sys_title] textarea, [data-field-id=sys_title] input").first()).toHaveValue("Lập bảng lương tháng 11");
});

test("a sub-task is added under its parent, shown as a tree and can be collapsed", async ({ page, seed }) => {
  const p = await project(page.request, seed.wsId, ["Onboarding nhân viên mới", "Task khác"]);
  await open(page, seed.slug, p.id, 2);
  const parent = row(page, p.tasks[0].id);
  await parent.hover();
  await parent.getByTestId("add-subtask").click();
  await expect(rows(page)).toHaveCount(3);
  await expect.poll(async () => (await records(page.request, p.id)).filter((r) => (r.data.sys_parent as string[] | undefined)?.[0] === p.tasks[0].id).length).toBe(1);
  await expect(page.getByTestId("subtask-connector")).toHaveCount(1);
  // Collapsing hides the child; expanding brings it back.
  await parent.getByTestId("subtask-toggle").click();
  await expect(rows(page)).toHaveCount(2);
  await parent.getByTestId("subtask-toggle").click();
  await expect(rows(page)).toHaveCount(3);
});

test("rows are inserted below a task from the context menu and deleted again", async ({ page, seed }) => {
  const p = await project(page.request, seed.wsId, ["Tuyển dụng Q4", "Đào tạo hội nhập"]);
  await open(page, seed.slug, p.id, 2);
  await row(page, p.tasks[0].id).getByTestId("row-handle").click({ button: "right" });
  await page.getByTestId("grid-insert-count").fill("2");
  await page.getByTestId("grid-insert-below").click();
  await expect(rows(page)).toHaveCount(4);
  await expect.poll(async () => (await records(page.request, p.id)).length).toBe(4);
  // The new rows sit right below the first task.
  const ids = await rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-record-id")));
  expect(ids[0]).toBe(p.tasks[0].id);
  expect(ids[3]).toBe(p.tasks[1].id);

  // Select the two new rows and delete them.
  for (const id of ids.slice(1, 3)) await row(page, id!).getByTestId("row-handle").getByRole("checkbox").click();
  await row(page, ids[1]!).getByTestId("row-handle").click({ button: "right" });
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId("grid-delete-rows").click();
  const confirm = page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: /xoá|delete/i });
  if (await confirm.count()) await confirm.first().click();
  await expect(rows(page)).toHaveCount(2);
  await expect.poll(async () => (await records(page.request, p.id)).length).toBe(2);
});

test("the side panel opens a task from its row", async ({ page, seed }) => {
  const p = await project(page.request, seed.wsId, ["Chuẩn bị hồ sơ BHXH"]);
  await open(page, seed.slug, p.id, 1);
  const r = row(page, p.tasks[0].id);
  await r.hover();
  await r.getByTestId("record-open-side").click();
  await expect(page.getByTestId("drawer-title")).toContainText("Chuẩn bị hồ sơ BHXH");
});

test("the name column stays frozen while the grid scrolls sideways", async ({ page, seed }) => {
  const p = await project(page.request, seed.wsId, ["Rà soát hợp đồng lao động"]);
  await open(page, seed.slug, p.id, 1);
  const title = row(page, p.tasks[0].id).locator("[data-field-id=sys_title]");
  await expect(title).toHaveCSS("position", "sticky");
  const before = (await title.boundingBox())!.x;
  await page.getByTestId("grid-view").evaluate((el) => {
    const scroller = [el, ...el.querySelectorAll("*")].find((n) => n.scrollWidth > n.clientWidth + 10 && /(auto|scroll)/.test(getComputedStyle(n).overflowX));
    if (scroller) scroller.scrollLeft = 400;
  });
  await expect.poll(async () => Math.round((await title.boundingBox())!.x)).toBe(Math.round(before));
});

test("each kind of cell saves what is typed or picked", async ({ page, seed }) => {
  const p = await project(page.request, seed.wsId, ["Khai báo thuế TNCN"]);
  const statuses = (await (await page.request.get(`/api/workspaces/${seed.wsId}/statuses`)).json()) as { id: string; name: string; category: string }[];
  const done = statuses.find((s) => s.category === "done")!;
  await open(page, seed.slug, p.id, 1);
  const r = row(page, p.tasks[0].id);
  const cell = (id: string) => r.locator(`[data-field-id=${id}]`);
  const saved = async () => (await (await page.request.get(`/api/tasks/${p.tasks[0].id}`)).json()) as Rec;

  // Long text (draft textarea), number (draft input) and date.
  await cell("sys_description").locator("textarea").fill("Tổng hợp chứng từ khấu trừ");
  await cell("sys_description").locator("textarea").blur();
  await cell("sys_estimate").locator("input").fill("90");
  await cell("sys_estimate").locator("input").press("Enter");
  await cell("sys_due_date").locator("input").fill("2036-12-15");
  await cell("sys_due_date").locator("input").blur();
  await expect.poll(async () => (await saved()).data.sys_description).toBe("Tổng hợp chứng từ khấu trừ");
  await expect.poll(async () => (await saved()).data.sys_estimate).toBe(90);
  await expect.poll(async () => (await saved()).data.sys_due_date).toBe("2036-12-15");

  // Progress slider (before the status: finishing a task sets it to 100%).
  await cell("sys_progress").locator("input[type=number]").fill("40");
  await cell("sys_progress").locator("input[type=number]").press("Enter");
  await expect.poll(async () => (await saved()).data.sys_progress).toBe(40);
  await cell("sys_progress").getByTestId("progress-slider").focus();
  await page.keyboard.press("ArrowRight"); // one 5% step, saved when the key is released
  await expect.poll(async () => (await saved()).data.sys_progress).toBe(45);

  // A single choice from a popover (status) and people (assignees).
  await cell("sys_status").getByRole("button").first().click();
  await page.getByRole("dialog").getByText(done.name, { exact: true }).click();
  await expect.poll(async () => (await saved()).data.sys_status).toBe(done.id);
  await expect.poll(async () => (await saved()).data.sys_progress, { message: "done means 100%" }).toBe(100);
  await page.keyboard.press("Escape");
  await cell("sys_assignees").getByRole("button").first().click();
  await page.getByRole("dialog").getByText("Hieu Diu-Thi").first().click();
  await expect.poll(async () => ((await saved()).data.sys_assignees as string[] | undefined)?.length ?? 0).toBe(1);
  await page.keyboard.press("Escape");

  // Read-only system cells show their value and have no input.
  await expect(cell("sys_created_by")).toContainText("Hieu Diu-Thi");
  await expect(cell("sys_created_by").locator("input, textarea, button")).toHaveCount(0);
});
