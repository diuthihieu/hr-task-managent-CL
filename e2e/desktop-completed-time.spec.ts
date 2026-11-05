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

test("sub-task list: the completed day typed in is the one shown and stored; the time of day is kept", async ({ page, seed }) => {
  const { post, p, done, parent } = await setup(page, seed.wsId);
  const child = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, {
    data: { sys_title: "Đóng dấu hồ sơ", sys_parent: [parent.id], sys_status: done, sys_actual: 1, sys_start_date: "2026-10-20", sys_due_date: "2026-10-25" },
  });
  const stored = async () => ((await (await page.request.get(`/api/tasks/${child.id}`)).json()) as Rec).data.sys_completed_at;
  expect(await stored(), "done does not mean finished now").toBeNull();

  await page.goto(`/w/${seed.slug}/p/${p.id}/t/${parent.id}`);
  // The list shows the completed time as a day only.
  const input = () => page.getByTestId("th-child-completed").first().locator("input");
  await expect(input()).toHaveAttribute("type", "date");
  await expect(input()).toHaveValue("");
  // No time yet: the picked day is stored at local noon (05:00 UTC), the same day in any report.
  await input().fill("2026-10-24");
  await input().press("Enter");
  await expect.poll(stored).toBe("2026-10-24T05:00:00.000Z");
  await page.reload();
  await expect(input()).toHaveValue("2026-10-24");
  // A time of day already stored (06:15 local = 23:15 UTC the day before) is kept and shown on its local day.
  expect((await page.request.patch(`/api/tasks/${child.id}`, { data: { data: { sys_completed_at: "2026-10-24T23:15:00.000Z" } } })).ok()).toBeTruthy();
  await page.reload();
  await expect(input()).toHaveValue("2026-10-25");
  await input().fill("2026-10-26");
  await input().press("Enter");
  await expect.poll(stored).toBe("2026-10-25T23:15:00.000Z");
});

test("done check: the completed date is required, starts empty; 'Today' fills it in; saved as the day picked", async ({ page, seed }) => {
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
  // Required: Esc doesn't dismiss it, there is no X, "skip" waits for the time, saving empty is refused.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /close/i })).toHaveCount(0);
  await expect(dialog.getByTestId("done-check-ignore")).toBeDisabled();
  await dialog.getByTestId("done-check-save").click();
  await expect(dialog).toBeVisible();
  await expect(completed).toHaveAttribute("aria-invalid", "true");
  await dialog.getByTestId("done-check-completed-now").click();
  await expect(completed).not.toHaveValue("");
  await expect(completed).toHaveAttribute("type", "date");
  await completed.fill("2026-10-26");
  await dialog.getByTestId("done-check-save").click();
  await expect(dialog).toBeHidden();
  // A day only, stored at local noon (05:00 UTC in Vietnam).
  await expect.poll(stored).toBe("2026-10-26T05:00:00.000Z");
});

test("Home: completing a task asks for the completed time; 'skip the rest' saves just that and Home lists it as completed", async ({ page, seed }) => {
  const { post, p } = await setup(page, seed.wsId);
  const me = ((await (await page.request.get("/api/auth/session")).json()) as { user: { id: string } }).user.id;
  const title = `Đối soát công ${Date.now().toString(36)}`;
  const task = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, { data: { sys_title: title, sys_assignees: [me] } });

  await page.goto(`/w/${seed.slug}`);
  const myTasks = page.getByTestId("home-my-tasks");
  // Home shows "my tasks" as a list or as a table, depending on the layout.
  const row = myTasks.locator("tr, [data-testid=cc-task]").filter({ hasText: title }).first();
  await row.hover();
  await row.locator("[data-testid=cc-complete], [data-testid=cc-row-complete]").first().click();
  const dialog = page.getByTestId("done-check-dialog");
  const completed = dialog.getByTestId("done-check-completed");
  await expect(completed).toHaveValue("");
  await expect(dialog.getByTestId("done-check-ignore")).toBeDisabled();
  await completed.fill("2026-11-04");
  await completed.press("Tab");
  await dialog.getByTestId("done-check-ignore").click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => ((await (await page.request.get(`/api/tasks/${task.id}`)).json()) as Rec).data.sys_completed_at).toBe("2026-11-04T05:00:00.000Z");

  await page.reload();
  await myTasks.getByRole("button", { name: /^(Hoàn thành|Completed) \d+$/ }).click();
  await expect(myTasks.getByText(title)).toBeVisible();
});
