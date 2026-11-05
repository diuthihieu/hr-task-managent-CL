// A late-logged sub-task's completed time can be typed in and is shown back in the viewer's own time
// (it used to show UTC: 7 hours early in Vietnam, and the day before for early-morning times).
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE, timezoneId: "Asia/Ho_Chi_Minh" });

test("sub-task list: the completed time typed in is the one shown and stored", async ({ page, seed }) => {
  const post = async <T,>(url: string, data: unknown) => {
    const res = await page.request.post(url, { data });
    expect(res.ok(), `${url} ${res.status()}`).toBeTruthy();
    return (await res.json()) as T;
  };
  const p = await post<{ id: string }>(`/api/workspaces/${seed.wsId}/projects`, { name: `Completed ${Date.now()}` });
  const statuses = (await (await page.request.get(`/api/workspaces/${seed.wsId}/statuses`)).json()) as { id: string; category: string }[];
  const done = statuses.find((s) => s.category === "done")!.id;
  const parent = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, { data: { sys_title: "Quyết định khen thưởng" } });
  const child = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, {
    data: { sys_title: "Đóng dấu hồ sơ", sys_parent: [parent.id], sys_status: done, sys_actual: 1, sys_start_date: "2026-10-20", sys_due_date: "2026-10-25" },
  });
  const stored = async () => ((await (await page.request.get(`/api/tasks/${child.id}`)).json()) as { data: { sys_completed_at: string | null } }).data.sys_completed_at;

  await page.goto(`/w/${seed.slug}/p/${p.id}/t/${parent.id}`);
  const input = () => page.getByTestId("th-child-completed").first().locator("input");
  // Marked done just now: the cell shows the local time of that moment, not UTC.
  const auto = new Date((await stored())!);
  const pad = (n: number) => String(n).padStart(2, "0");
  const vn = new Date(auto.getTime() + 7 * 3600_000);
  await expect(input()).toHaveValue(`${vn.getUTCFullYear()}-${pad(vn.getUTCMonth() + 1)}-${pad(vn.getUTCDate())}T${pad(vn.getUTCHours())}:${pad(vn.getUTCMinutes())}`);

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
