// "Export my data" from the account menu: filters, column choice, a preview of the count and hours,
// and a real XLSX download.
import * as XLSX from "xlsx";
import { readFile } from "node:fs/promises";
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("export my data: preview follows the filters and the download holds the chosen columns", async ({ page, seed }) => {
  const tag = Date.now().toString(36);
  const post = async (url: string, data: unknown) => {
    const res = await page.request.post(url, { data });
    expect(res.ok(), `${url} ${res.status()}`).toBeTruthy();
    return (await res.json()) as { id: string };
  };
  const me = ((await (await page.request.get("/api/auth/session")).json()) as { user: { id: string } }).user.id;
  const p = await post(`/api/workspaces/${seed.wsId}/projects`, { name: `Xuất ${tag}` });
  await post(`/api/projects/${p.id}/tasks`, { data: { sys_title: `Báo cáo C&B ${tag}`, sys_assignees: [me], sys_actual: 2.5, sys_due_date: "2026-10-20" } });
  await post(`/api/projects/${p.id}/tasks`, { data: { sys_title: `Không phải của tôi ${tag}`, sys_actual: 1, sys_due_date: "2026-10-21" } });

  await page.goto(`/w/${seed.slug}`);
  await page.getByTestId("user-menu").click();
  await page.getByTestId("menu-my-export").click();
  const dialog = page.getByTestId("my-export-dialog");
  await expect(dialog).toBeVisible();

  // Narrow to the new project: "assignee = me" is on by default.
  await dialog.getByTestId("mx-projects").click();
  await page.getByTestId("mx-projects-search").fill(`Xuất ${tag}`);
  await page.getByTestId("mx-projects-list").getByRole("option").first().click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByTestId("mx-preview")).toContainText(/^1 task - 2.5 giờ|^1 task\(s\) - 2.5 actual hours/);

  // Clearing the assignee filter takes every task I can see.
  await dialog.getByTestId("mx-assignees").click();
  await page.getByTestId("mx-assignees-clear").click();
  await page.keyboard.press("Escape");
  await expect(dialog.getByTestId("mx-preview")).toContainText(/^2 task - 3.5 giờ|^2 task\(s\) - 3.5 actual hours/);

  await dialog.getByTestId("mx-col-dueDate").check();
  const [download] = await Promise.all([page.waitForEvent("download"), dialog.getByTestId("mx-download").click()]);
  expect(download.suggestedFilename()).toMatch(/^woli-tasks-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const wb = XLSX.read(await readFile((await download.path())!), { type: "buffer" });
  const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Tasks, { header: 1 });
  expect(rows).toHaveLength(3);
  expect(rows.flat()).toContain(`Báo cáo C&B ${tag}`);
  expect(rows.flat()).toContain("2026-10-20");
});
