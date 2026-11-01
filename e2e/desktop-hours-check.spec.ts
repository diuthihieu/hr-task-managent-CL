// U7: raising a sub-task's hours above its parent's opens the parent-hours dialog; accepting it
// updates the parent and leaves the sub-task's page showing the sub-task.
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("sub-task page: the parent-hours correction updates the parent, the page stays on the sub-task", async ({ page, seed }) => {
  const post = async <T,>(url: string, data: unknown) => {
    const res = await page.request.post(url, { data });
    expect(res.ok(), `${url} ${res.status()}`).toBeTruthy();
    return (await res.json()) as T;
  };
  const p = await post<{ id: string }>(`/api/workspaces/${seed.wsId}/projects`, { name: `Hours ${Date.now()}` });
  const parent = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, { data: { sys_title: "Chốt lương tháng 10", sys_actual: 1 } });
  const child = await post<{ id: string }>(`/api/projects/${p.id}/tasks`, { data: { sys_title: "Đối soát công", sys_parent: [parent.id], sys_actual: 0.5 } });
  const fields = ((await (await page.request.get(`/api/projects/${p.id}`)).json()) as { fields: { id: string; name: string }[] }).fields;
  const actualName = fields.find((f) => f.id === "sys_actual")!.name;

  await page.goto(`/w/${seed.slug}/p/${p.id}/t/${child.id}`);
  await expect(page.getByTestId("record-title")).toHaveValue("Đối soát công");
  const input = page.locator(`div[title="${actualName}"] + div input`);
  await input.fill("2");
  await input.press("Enter");

  const dialog = page.getByTestId("hours-check-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("hours-check-actual")).toHaveValue("2");
  await dialog.getByTestId("hours-check-save").click();
  await expect(dialog).toBeHidden();

  await expect.poll(async () => ((await (await page.request.get(`/api/tasks/${parent.id}`)).json()) as { data: { sys_actual: number } }).data.sys_actual).toBe(2);
  await expect(page.getByTestId("record-title")).toHaveValue("Đối soát công");
  await expect(input).toHaveValue("2");
});
