// D5: summary table columns can be widened / narrowed by dragging (saved by an editor), header text
// wraps, and the header takes the colours picked for it.
import { AUTH_FILE, test, expect } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("summary table: header colours, wrapping header, drag a column wider and it stays after reload", async ({ page, seed }) => {
  const request = page.request;
  const post = async (url: string, data: unknown) => {
    const res = await request.post(url, { data });
    expect(res.ok(), `${url} ${res.status()}`).toBeTruthy();
    return res.json();
  };
  const project = await post(`/api/workspaces/${seed.wsId}/projects`, { name: "Styled table", categories: [{ name: "Payroll" }] });
  const cats = (await (await request.get(`/api/projects/${project.id}/categories`)).json()) as { id: string }[];
  await post(`/api/projects/${project.id}/tasks`, { data: { sys_title: "Pay", sys_category: cats[0].id, sys_actual: 3 } });
  const dash = await post(`/api/workspaces/${seed.wsId}/dashboards`, { name: "Styled" });
  await post(`/api/dashboards/${dash.id}/blocks`, {
    type: "pivot",
    title: "Styled",
    w: 8,
    h: 7,
    config: { dataSource: { projectId: project.id }, dimensionFieldId: "sys_category", measureFieldId: "sys_actual", aggregation: "sum", style: { headerBackground: "#1e3a8a", headerTextColor: "#ffffff" } },
  });

  const fields = (await (await request.get(`/api/projects/${project.id}`)).json()).fields as { id: string; name: string }[];
  const actualName = fields.find((f) => f.id === "sys_actual")!.name;
  await page.goto(`/w/${seed.slug}/dash/${dash.id}`);
  const head = page.getByTestId("pivot-head");
  await expect(head).toBeVisible({ timeout: 30_000 });
  await expect(head).toHaveCSS("background-color", "rgb(30, 58, 138)");
  const firstTh = head.locator("th[data-col='__rows']");
  await expect(firstTh).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(firstTh).toHaveCSS("white-space", "normal");

  // The value column's header becomes the field's name once the dashboard's field list has loaded,
  // which re-flows the columns: wait for it, then until the column stops moving, before grabbing its edge.
  await expect(head).toContainText(actualName);
  const settled = async (loc: typeof firstTh) =>
    expect
      .poll(async () => {
        const a = (await loc.boundingBox())!;
        await page.waitForTimeout(250);
        const b = (await loc.boundingBox())!;
        return Math.abs(a.x - b.x) + Math.abs(a.width - b.width);
      })
      .toBeLessThan(0.5);
  await settled(firstTh);
  const before = (await firstTh.boundingBox())!.width;
  const grip = firstTh.getByTestId("pivot-resize");
  const box = (await grip.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 140, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await firstTh.boundingBox())!.width).toBeGreaterThan(before + 100);
  const widened = (await firstTh.boundingBox())!.width;

  // Saved for everyone by the editor: still that wide after a reload.
  await expect.poll(async () => {
    const d = (await (await request.get(`/api/dashboards/${dash.id}`)).json()) as { blocks: { config: string }[] };
    return (JSON.parse(d.blocks[0].config).style?.columnWidths?.__rows as number | undefined) ?? 0;
  }).toBeGreaterThan(before + 100);
  await page.reload();
  await expect(page.getByTestId("pivot-head").locator("th[data-col='__rows']")).toBeVisible({ timeout: 30_000 });
  const th = page.getByTestId("pivot-head").locator("th[data-col='__rows']");
  await expect(page.getByTestId("pivot-head")).toContainText(actualName);
  await settled(th);
  expect(Math.abs((await th.boundingBox())!.width - widened)).toBeLessThan(4);

  // The table doesn't stretch sized columns: dragging an edge left makes the column narrower by that much.
  const g = (await th.getByTestId("pivot-resize").boundingBox())!;
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.mouse.down();
  await page.mouse.move(g.x - 80, g.y + g.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await th.boundingBox())!.width)).toBeLessThan(widened - 60);
  expect((await th.boundingBox())!.width).toBeGreaterThan(widened - 100);
});
