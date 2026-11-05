// Calendar view: "+" on a day opens the new-task form starting on that day; the task lands on that day.
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("calendar: add a task on the day clicked (start date = that day, shown on that day)", async ({ page, seed }) => {
  const post = async <T,>(url: string, data: unknown) => {
    const res = await page.request.post(url, { data });
    expect(res.ok(), `${url} ${res.status()}`).toBeTruthy();
    return (await res.json()) as T;
  };
  const p = await post<{ id: string }>(`/api/workspaces/${seed.wsId}/projects`, { name: `Calendar ${Date.now()}` });
  // The calendar shows the due date, so the new task needs both dates on the day clicked to show there.
  const view = await post<{ id: string }>(`/api/projects/${p.id}/views`, { name: "Calendar", type: "calendar", config: { calendar: { dateFieldId: "sys_due_date", mode: "month" } } });

  await page.goto(`/w/${seed.slug}/p/${p.id}?view=${view.id}`);
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-12`;
  const add = page.locator(`[data-testid=cal-add][data-day="${day}"]`);
  await add.hover();
  await add.click();

  const dialog = page.getByTestId("new-task-dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByTestId("ntd-title").fill("Phỏng vấn ứng viên C&B");
  await dialog.getByTestId("ntd-add").click();
  await expect(dialog).toBeHidden();

  const tasks = (await (await page.request.get(`/api/projects/${p.id}/tasks`)).json()) as { data: { sys_title: string; sys_start_date: string | null; sys_due_date: string | null } }[];
  const created = tasks.find((x) => x.data.sys_title === "Phỏng vấn ứng viên C&B");
  expect(created?.data.sys_start_date?.slice(0, 10), "start date = the day clicked").toBe(day);
  expect(created?.data.sys_due_date?.slice(0, 10), "the calendar's own date field too").toBe(day);
  // It appears in that day's cell.
  const cell = page.locator(`[data-testid=cal-add][data-day="${day}"]`).locator("xpath=ancestor::div[contains(@class,'group/day')][1]");
  await expect(cell.getByText("Phỏng vấn ứng viên C&B")).toBeVisible();
});

