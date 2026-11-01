// U8: the summary table widget renders on a dashboard and exports what it shows as CSV and Excel.
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { AUTH_FILE, test, expect } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("summary table: hours per assignee x category, CSV and XLSX downloads match the table", async ({ page, seed }) => {
  const request = page.request;
  const post = async (url: string, data: unknown) => {
    const res = await request.post(url, { data });
    expect(res.ok(), `${url} ${res.status()}`).toBeTruthy();
    return res.json();
  };
  const me = (await (await request.get("/api/auth/session")).json()).user.id as string;
  const project = await post(`/api/workspaces/${seed.wsId}/projects`, { name: "Giờ làm việc", categories: [{ name: "Payroll" }, { name: "Tuyển dụng" }] });
  const cats = (await (await request.get(`/api/projects/${project.id}/categories`)).json()) as { id: string; name: string }[];
  const cat = (n: string) => cats.find((c) => c.name === n)!.id;
  await post(`/api/projects/${project.id}/tasks`, { data: { sys_title: "Chốt công", sys_category: cat("Payroll"), sys_assignees: [me], sys_actual: 6 } });
  await post(`/api/projects/${project.id}/tasks`, { data: { sys_title: "Phỏng vấn", sys_category: cat("Tuyển dụng"), sys_assignees: [me], sys_actual: 2.5 } });
  const dash = await post(`/api/workspaces/${seed.wsId}/dashboards`, { name: "Giờ làm việc T10" });
  await post(`/api/dashboards/${dash.id}/blocks`, {
    type: "pivot",
    title: "Giờ thực tế theo người và danh mục",
    w: 8,
    h: 8,
    config: { dataSource: { projectId: project.id }, dimensionFieldId: "sys_assignees", dimension2FieldId: "sys_category", measureFieldId: "sys_actual", aggregation: "sum" },
  });

  await page.goto(`/w/${seed.slug}/dash/${dash.id}`);
  const table = page.getByTestId("pivot-table");
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(table.getByRole("columnheader", { name: "Payroll" })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Tuyển dụng" })).toBeVisible();
  await expect(table.getByRole("row", { name: /Hieu Diu-Thi/ })).toContainText("8.5");

  const csvDl = page.waitForEvent("download");
  await table.getByTestId("pivot-csv").click();
  const csvFile = await csvDl;
  expect(csvFile.suggestedFilename()).toBe("Gio thuc te theo nguoi va danh muc.csv");
  const csv = readFileSync((await csvFile.path())!, "utf8");
  expect(csv.charCodeAt(0), "BOM so Excel reads Vietnamese").toBe(0xfeff);
  expect(csv).toContain("Payroll,Tuyển dụng");
  expect(csv).toMatch(/Hieu Diu-Thi,6,2\.5,8\.5/);

  const xlsxDl = page.waitForEvent("download");
  await table.getByTestId("pivot-xlsx").click();
  const file = await xlsxDl;
  expect(file.suggestedFilename()).toBe("Gio thuc te theo nguoi va danh muc.xlsx");
  const wb = XLSX.read(readFileSync((await file.path())!));
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  expect(rows.find((r) => r[0] === "Hieu Diu-Thi")).toEqual(["Hieu Diu-Thi", 6, 2.5, 8.5]);
});
