// The parent's sub-task list lines its columns up, whether or not a sub-task has a due date.
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("sub-task list: status, PIC, completed and due columns line up on every row", async ({ page, seed }) => {
  const post = async <T,>(url: string, data: unknown) => {
    const res = await page.request.post(url, { data });
    expect(res.ok(), `${url} ${res.status()}`).toBeTruthy();
    return (await res.json()) as T;
  };
  const p = await post<{ id: string }>(`/api/workspaces/${seed.wsId}/projects`, { name: `Subtask cols ${Date.now()}` });
  const parent = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, { data: { sys_title: "Quyết định khen thưởng", sys_due_date: "2026-11-20" } });
  await post(`/api/projects/${p.id}/tasks`, { data: { sys_title: "Không có hạn chót", sys_parent: [parent.id] } });
  await post(`/api/projects/${p.id}/tasks`, { data: { sys_title: "Có hạn chót", sys_parent: [parent.id], sys_due_date: "2026-11-02" } });

  await page.goto(`/w/${seed.slug}/p/${p.id}/t/${parent.id}`);
  const list = page.getByTestId("th-children");
  await expect(list.getByTestId("th-child")).toHaveCount(2);
  for (const id of ["th-child-status", "th-child-pic", "th-child-completed", "th-child-due"]) {
    const cells = list.getByTestId(id);
    await expect(cells).toHaveCount(2);
    const [a, b] = [await cells.nth(0).boundingBox(), await cells.nth(1).boundingBox()];
    expect(a && b, id).toBeTruthy();
    expect(Math.round(a!.x), id).toBe(Math.round(b!.x));
    expect(Math.round(a!.width), id).toBe(Math.round(b!.width));
  }
  // The header's columns sit over the cells.
  const head = list.getByTestId("th-children-head");
  for (const [col, cell] of [["th-head-pic", "th-child-pic"], ["th-head-completed", "th-child-completed"], ["th-head-due", "th-child-due"]]) {
    const h = await head.getByTestId(col).boundingBox();
    const c = await list.getByTestId(cell).first().boundingBox();
    expect(Math.round(h!.x), col).toBe(Math.round(c!.x));
  }
});
