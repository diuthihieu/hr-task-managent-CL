// The parent's sub-task list lines its columns up, whether or not a sub-task has a due date.
import { PrismaClient } from "@prisma/client";
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
  const longTitle = "Làm quyết định phân công trách nhiệm cho bộ phận C&B về việc rà soát bảng lương, bảo hiểm và thuế TNCN quý 4";
  await post(`/api/projects/${p.id}/tasks`, { data: { sys_title: longTitle, sys_parent: [parent.id] } });
  const me = ((await (await page.request.get("/api/auth/session")).json()) as { user: { id: string } }).user.id;
  // Two more workspace members, so one sub-task has three people.
  const prisma = new PrismaClient();
  const tag = Date.now().toString(36);
  const extra: string[] = [];
  for (const name of ["Trần Ngọc Lan", "Lê Quang Minh"]) {
    const u = await prisma.user.create({ data: { email: `${tag}.${extra.length}@cols.test`, name, systemRole: "MEMBER", passwordHash: "x", mustChangePassword: false, emailVerifiedAt: new Date() } });
    await prisma.workspaceMember.create({ data: { workspaceId: seed.wsId, userId: u.id, role: "editor" } });
    extra.push(u.id);
  }
  await prisma.$disconnect();
  const many = [me, ...extra];
  await post(`/api/projects/${p.id}/tasks`, { data: { sys_title: "Có hạn chót", sys_parent: [parent.id], sys_due_date: "2026-11-02", sys_assignees: many } });

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
  // Several people: every one is shown (wrapping onto more lines), none folded into "+N".
  const pic = list.getByTestId("th-child-pic").nth(1);
  await expect(pic.locator("[data-chip]")).toHaveCount(many.length);
  await expect(pic.getByTestId("people-more")).toHaveCount(0);
  for (const chip of await pic.locator("[data-chip]").all()) await expect(chip).toBeVisible();
  // The completed column is as wide as its date-time input, so the picker icon is not cut off.
  const fits = await list.getByTestId("th-child-completed").first().locator("input").evaluate((el: HTMLInputElement) => {
    const shown = el.getBoundingClientRect().width;
    el.style.width = "max-content";
    const natural = el.getBoundingClientRect().width;
    el.style.width = "";
    return natural <= shown + 1;
  });
  expect(fits, "completed input shown at its natural width").toBe(true);
  // A long sub-task name wraps onto more lines and is shown in full (no "…").
  const name = list.getByTestId("th-child").filter({ hasText: "quyết định phân công" });
  await expect(name).toHaveText(longTitle);
  const wrap = await name.evaluate((el) => ({ fits: el.scrollWidth <= el.clientWidth + 1, lines: Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)) }));
  expect(wrap.fits, "nothing cut off").toBe(true);
  expect(wrap.lines, "wraps onto several lines").toBeGreaterThan(1);
  // The completed column shows a day only.
  await expect(list.getByTestId("th-child-completed").first().locator("input")).toHaveAttribute("type", "date");
});
