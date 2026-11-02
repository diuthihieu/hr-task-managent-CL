// D3: dashboard slicers work like Power BI's - search, multi-select (OR), Select all, Clear, AND with
// a date range (both ends included), "no data" without dropping the selection, Reset filters.
import { AUTH_FILE, test, expect } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("slicers: search, pick several, select all, clear, date range, no data and reset update the KPI", async ({ page, seed }) => {
  const request = page.request;
  const post = async (url: string, data: unknown) => {
    const res = await request.post(url, { data });
    expect(res.ok(), `${url} ${res.status()}`).toBeTruthy();
    return res.json();
  };
  const project = await post(`/api/workspaces/${seed.wsId}/projects`, { name: "Slicer UI", categories: [{ name: "Payroll" }, { name: "Recruit" }] });
  const cats = (await (await request.get(`/api/projects/${project.id}/categories`)).json()) as { id: string; name: string }[];
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  const task = (title: string, category: string, actual: number, due: string) => post(`/api/projects/${project.id}/tasks`, { data: { sys_title: title, sys_category: cat(category), sys_actual: actual, sys_due_date: due } });
  await task("A", "Payroll", 6, "2026-10-01");
  await task("B", "Recruit", 4, "2026-10-15");
  await task("C", "Payroll", 2, "2026-10-31");
  const fields = (await (await request.get(`/api/projects/${project.id}`)).json()).fields as { id: string; name: string }[];
  const name = (id: string) => fields.find((f) => f.id === id)!.name;
  const dash = await post(`/api/workspaces/${seed.wsId}/dashboards`, { name: "Slicers" });
  await post(`/api/dashboards/${dash.id}/blocks`, { type: "kpi", title: "Hours", w: 4, h: 4, config: { dataSource: { projectId: project.id }, measureFieldId: "sys_actual", aggregation: "sum" } });
  const patched = await request.patch(`/api/dashboards/${dash.id}`, { data: { filters: { slicers: [{ id: "cat", fieldName: name("sys_category") }, { id: "due", fieldName: name("sys_due_date") }] } } });
  expect(patched.ok()).toBeTruthy();

  await page.goto(`/w/${seed.slug}/dash/${dash.id}`);
  const kpi = page.locator("[data-kpi-number]");
  await expect(kpi).toHaveText("12", { timeout: 30_000 });
  const categorySlicer = page.locator(`[data-testid=slicer][data-slicer-field="${name("sys_category")}"]`);
  const value = (label: string) => page.locator(`[data-testid=slicer-value][data-value="${label}"]`);

  await categorySlicer.click();
  await expect(value("Payroll")).toContainText("2");
  await page.getByTestId("slicer-search").fill("pay");
  await expect(value("Recruit")).toHaveCount(0);
  await value("Payroll").click();
  await expect(kpi).toHaveText("8");
  await page.getByTestId("slicer-search").fill("");
  await value("Recruit").click();
  await expect(kpi).toHaveText("12", { timeout: 10_000 });
  await expect(categorySlicer).toContainText("Payroll, Recruit");
  await page.getByTestId("slicer-clear").click();
  await expect(categorySlicer).not.toContainText("Payroll");
  await page.getByTestId("slicer-select-all").click();
  await expect(categorySlicer).toContainText("Payroll, Recruit");
  await page.getByTestId("slicer-clear").click();
  await value("Payroll").click();
  await expect(kpi).toHaveText("8");
  await page.keyboard.press("Escape");

  await page.locator(`[data-testid=slicer][data-slicer-field="${name("sys_due_date")}"]`).click();
  await page.getByTestId("slicer-from").fill("2026-10-02");
  await page.getByTestId("slicer-to").fill("2026-10-31");
  await expect(kpi).toHaveText("2", { timeout: 10_000 });
  await page.getByTestId("slicer-to").fill("2026-10-15");
  await expect(page.getByTestId("widget-no-data")).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press("Escape");

  await categorySlicer.click();
  await expect(value("Payroll"), "the selection stays, with no task left").toContainText("0");
  await expect(value("Recruit"), "options follow the date slicer").toContainText("1");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("slicer-active-count")).toBeVisible();

  await page.getByTestId("slicer-reset").click();
  await expect(kpi).toHaveText("12", { timeout: 10_000 });
  await expect(page.getByTestId("slicer-reset")).toHaveCount(0);
});
