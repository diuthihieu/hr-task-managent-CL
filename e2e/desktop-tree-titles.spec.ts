// Task table: a parent task looks like any other task (same start, normal weight); only its sub-tasks
// are indented, with the branch line, smaller and lighter.
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("table: parent title lines up with plain tasks and is not bold; sub-task is indented, smaller and lighter", async ({ page, seed }) => {
  const post = async <T,>(url: string, data: unknown) => {
    const res = await page.request.post(url, { data });
    expect(res.ok(), `${url} ${res.status()}`).toBeTruthy();
    return (await res.json()) as T;
  };
  const p = await post<{ id: string }>(`/api/workspaces/${seed.wsId}/projects`, { name: `Tree ${Date.now()}` });
  const parent = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, { data: { sys_title: "Tính lương tháng 10" } });
  const child = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, { data: { sys_title: "Update bảng công", sys_parent: [parent.id] } });
  const plain = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, { data: { sys_title: "Check danh sách nhân viên" } });

  await page.goto(`/w/${seed.slug}/p/${p.id}`);
  const title = (id: string) => page.locator(`[data-testid=grid-view] [role=row][data-record-id="${id}"] input`).first();
  await expect(title(parent.id)).toHaveValue("Tính lương tháng 10");
  await expect(title(child.id)).toBeVisible();
  const box = async (id: string) => (await title(id).boundingBox())!;
  const style = (id: string) => title(id).evaluate((el) => { const s = getComputedStyle(el); return { weight: Number(s.fontWeight), size: parseFloat(s.fontSize), color: s.color }; });

  const [pb, cb, qb] = [await box(parent.id), await box(child.id), await box(plain.id)];
  expect(Math.round(pb.x), "parent title starts where a plain task's title starts").toBe(Math.round(qb.x));
  expect(cb.x, "sub-task indented").toBeGreaterThan(qb.x + 10);
  const [ps, cs, qs] = [await style(parent.id), await style(child.id), await style(plain.id)];
  expect(ps, "parent styled like a plain task").toEqual(qs);
  expect(ps.weight).toBeLessThan(600);
  expect(cs.size, "sub-task smaller").toBeLessThan(qs.size);
  expect(cs.color, "sub-task lighter").not.toBe(qs.color);
  await expect(page.locator(`[role=row][data-record-id="${child.id}"] [data-testid=subtask-connector]`)).toHaveCount(1);
  await expect(page.locator(`[role=row][data-record-id="${parent.id}"] [data-testid=subtask-count]`)).toHaveText("1");
});
