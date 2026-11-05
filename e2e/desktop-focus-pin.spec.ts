// Home "Your focus today": < and > walk the priority order; a pinned task stays the focus (on every
// device, after reload) until it is done, then the priority order takes over again.
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("focus: step through by priority, pin one until it is done", async ({ page }) => {
  const post = async <T,>(url: string, data: unknown) => {
    const res = await page.request.post(url, { data });
    expect(res.ok(), `${url} ${res.status()} ${await res.text()}`).toBeTruthy();
    return (await res.json()) as T;
  };
  // A fresh workspace, so only these tasks compete for the focus.
  const ws = await post<{ id: string; slug: string }>("/api/workspaces", { name: `Focus ${Date.now()}` });
  const me = ((await (await page.request.get("/api/auth/session")).json()) as { user: { id: string } }).user.id;
  const p = await post<{ id: string }>(`/api/workspaces/${ws.id}/projects`, { name: "C&B" });
  const statuses = (await (await page.request.get(`/api/workspaces/${ws.id}/statuses`)).json()) as { id: string; category: string }[];
  const st = (c: string) => statuses.find((x) => x.category === c)!.id;
  const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);
  const task = (title: string, data: Record<string, unknown>) => post<{ id: string }>(`/api/projects/${p.id}/tasks`, { data: { sys_title: title, sys_assignees: [me], ...data } });
  const overdue = await task("Chốt bảng lương tháng 10", { sys_due_date: day(-1) });
  await task("Gửi payslip", { sys_due_date: day(0) });
  const wip = await task("Rà soát BHXH", { sys_status: st("in_progress") });

  await page.goto(`/w/${ws.slug}`);
  const focus = page.getByTestId("cc-focus");
  await expect(focus).toContainText("Chốt bảng lương tháng 10"); // overdue first
  await expect(focus.getByTestId("cc-focus-pos")).toHaveText("1/3");
  await expect(focus.getByTestId("cc-focus-prev")).toBeDisabled();
  await focus.getByTestId("cc-focus-next").click();
  await expect(focus).toContainText("Gửi payslip"); // then due today
  await focus.getByTestId("cc-focus-next").click();
  await expect(focus).toContainText("Rà soát BHXH"); // then in progress
  await expect(focus.getByTestId("cc-focus-pos")).toHaveText("3/3");
  await expect(focus.getByTestId("cc-focus-next")).toBeDisabled();

  // Pin the in-progress one: it becomes the focus and stays after a reload.
  await focus.getByTestId("cc-focus-pin").click();
  await expect(focus.getByTestId("cc-focus-pinned")).toBeVisible();
  await expect(focus.getByTestId("cc-focus-pos")).toHaveText("1/3");
  await page.reload();
  await expect(focus).toContainText("Rà soát BHXH");
  await expect(focus.getByTestId("cc-focus-pinned")).toBeVisible();

  // Only an open task of mine can be pinned.
  const other = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, { data: { sys_title: "Not mine" } });
  expect((await page.request.put(`/api/workspaces/${ws.id}/focus`, { data: { taskId: other.id } })).status()).toBe(400);

  // Done: the pin ends and the priority order is back.
  expect((await page.request.patch(`/api/tasks/${wip.id}`, { data: { data: { sys_status: st("done"), sys_completed_at: new Date().toISOString() } } })).ok()).toBeTruthy();
  await page.reload();
  await expect(focus).toContainText("Chốt bảng lương tháng 10");
  await expect(focus.getByTestId("cc-focus-pinned")).toHaveCount(0);
  void overdue;
});
