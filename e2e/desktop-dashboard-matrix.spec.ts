// D4: the summary table as a Power BI-like matrix - drill down with +/-, expand / collapse all,
// hide a level, and CSV of exactly what is shown.
import { readFileSync } from "node:fs";
import { AUTH_FILE, test, expect } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("matrix: rows by category then assignee, drill down, expand / collapse all, hide a level, export what is shown", async ({ page, seed }) => {
  const request = page.request;
  const post = async (url: string, data: unknown) => {
    const res = await request.post(url, { data });
    expect(res.ok(), `${url} ${res.status()}`).toBeTruthy();
    return res.json();
  };
  const me = (await (await request.get("/api/auth/session")).json()).user.id as string;
  const project = await post(`/api/workspaces/${seed.wsId}/projects`, { name: "Matrix", categories: [{ name: "Payroll" }, { name: "Recruit" }] });
  const cats = (await (await request.get(`/api/projects/${project.id}/categories`)).json()) as { id: string; name: string }[];
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  await post(`/api/projects/${project.id}/tasks`, { data: { sys_title: "Pay", sys_category: cat("Payroll"), sys_assignees: [me], sys_actual: 6 } });
  await post(`/api/projects/${project.id}/tasks`, { data: { sys_title: "Hire", sys_category: cat("Recruit"), sys_assignees: [me], sys_actual: 2 } });
  const dash = await post(`/api/workspaces/${seed.wsId}/dashboards`, { name: "Matrix" });
  await post(`/api/dashboards/${dash.id}/blocks`, {
    type: "pivot",
    title: "Hours matrix",
    w: 8,
    h: 9,
    config: { dataSource: { projectId: project.id }, dimensionFieldId: "sys_category", rowFieldIds: ["sys_category", "sys_assignees"], measureFieldId: "sys_actual", aggregation: "sum" },
  });

  await page.goto(`/w/${seed.slug}/dash/${dash.id}`);
  const table = page.getByTestId("pivot-table");
  const row = (label: string, depth: number) => table.locator(`[data-testid=pivot-row][data-depth="${depth}"][data-label="${label}"]`);
  await expect(row("Payroll", 0)).toContainText("6", { timeout: 30_000 });
  await expect(row("Recruit", 0)).toContainText("2");
  await expect(table.locator("[data-testid=pivot-row][data-depth='1']"), "children start collapsed, like Power BI").toHaveCount(0);

  await row("Payroll", 0).getByTestId("pivot-toggle").click();
  await expect(row("Hieu Diu-Thi", 1)).toHaveCount(1);
  await expect(row("Hieu Diu-Thi", 1)).toContainText("6");
  await table.getByTestId("pivot-expand-all").click();
  await expect(table.locator("[data-testid=pivot-row][data-depth='1']")).toHaveCount(2);

  const csvDl = page.waitForEvent("download");
  await table.getByTestId("pivot-csv").click();
  const csv = readFileSync((await (await csvDl).path())!, "utf8");
  expect(csv).toMatch(/Payroll,,6\r\nPayroll,Hieu Diu-Thi,6\r\nRecruit,,2\r\nRecruit,Hieu Diu-Thi,2/);

  await table.getByTestId("pivot-collapse-all").click();
  await expect(table.locator("[data-testid=pivot-row][data-depth='1']")).toHaveCount(0);

  await table.getByTestId("pivot-levels").click();
  await page.locator("[data-testid=pivot-level]").first().click();
  await expect(row("Hieu Diu-Thi", 0), "category hidden: the assignee is the only level, worked out again").toContainText("8", { timeout: 10_000 });
  await expect(row("Payroll", 0)).toHaveCount(0);
});
