// The completed time of a task is the time the work was really finished:
// - marking a task done does not fill in "now"; the done check asks for it, starting empty;
// - a time typed in the sub-task list is shown back in the viewer's own time (it used to show UTC:
//   7 hours early in Vietnam, and the day before for early-morning times).
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE, timezoneId: "Asia/Ho_Chi_Minh" });

type Rec = { data: { sys_completed_at: string | null } };

async function setup(page: import("@playwright/test").Page, wsId: string) {
  const post = async <T,>(url: string, data: unknown) => {
    const res = await page.request.post(url, { data });
    expect(res.ok(), `${url} ${res.status()}`).toBeTruthy();
    return (await res.json()) as T;
  };
  const p = await post<{ id: string }>(`/api/workspaces/${wsId}/projects`, { name: `Completed ${Date.now()}` });
  const statuses = (await (await page.request.get(`/api/workspaces/${wsId}/statuses`)).json()) as { id: string; category: string }[];
  const done = statuses.find((s) => s.category === "done")!.id;
  const parent = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, { data: { sys_title: "Quyết định khen thưởng" } });
  return { post, p, done, parent };
}

test("sub-task list: the completed time typed in is the one shown and stored", async ({ page, seed }) => {
  const { post, p, done, parent } = await setup(page, seed.wsId);
  const child = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, {
    data: { sys_title: "Đóng dấu hồ sơ", sys_parent: [parent.id], sys_status: done, sys_actual: 1, sys_start_date: "2026-10-20", sys_due_date: "2026-10-25" },
  });
  const stored = async () => ((await (await page.request.get(`/api/tasks/${child.id}`)).json()) as Rec).data.sys_completed_at;
  expect(await stored(), "done does not mean finished now").toBeNull();

  await page.goto(`/w/${seed.slug}/p/${p.id}/t/${parent.id}`);
  const input = () => page.getByTestId("th-child-completed").first().locator("input");
  await expect(input()).toHaveValue("");
  for (const [typed, utc] of [
    ["2026-10-24T09:30", "2026-10-24T02:30:00.000Z"],
    ["2026-10-25T06:15", "2026-10-24T23:15:00.000Z"], // before 07:00: must not slip to the 24th on screen
  ]) {
    await input().fill(typed);
    await input().press("Enter");
    await expect.poll(stored).toBe(utc);
    await page.reload();
    await expect(input()).toHaveValue(typed);
  }
});

test("done check: asks for the completed time, empty; 'Now' fills it in; saved as typed", async ({ page, seed }) => {
  const { post, p, done, parent } = await setup(page, seed.wsId);
  const child = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, { data: { sys_title: "Hướng dẫn làm lương", sys_parent: [parent.id] } });
  const stored = async () => ((await (await page.request.get(`/api/tasks/${child.id}`)).json()) as Rec).data.sys_completed_at;

  // Mark it done from the parent's sub-task list, as a user does.
  const statusName = ((await (await page.request.get(`/api/workspaces/${seed.wsId}/statuses`)).json()) as { id: string; name: string }[]).find((s) => s.id === done)!.name;
  await page.goto(`/w/${seed.slug}/p/${p.id}/t/${parent.id}`);
  await page.getByTestId("th-child-status").first().locator("button").click();
  await page.getByRole("button", { name: statusName, exact: true }).click();

  const dialog = page.getByTestId("done-check-dialog");
  await expect(dialog).toBeVisible();
  const completed = dialog.getByTestId("done-check-completed");
  await expect(completed).toHaveValue("");
  expect(await stored(), "nothing guessed while the dialog is open").toBeNull();
  await dialog.getByTestId("done-check-completed-now").click();
  await expect(completed).not.toHaveValue("");
  await completed.fill("2026-10-26T19:44");
  await dialog.getByTestId("done-check-save").click();
  await expect(dialog).toBeHidden();
  await expect.poll(stored).toBe("2026-10-26T12:44:00.000Z");
});
