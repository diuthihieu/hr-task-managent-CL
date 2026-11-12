// Agent Work → Workflows: set one up by hand (Skill, parameter, schedule), see its schedule and next run,
// pause it, delete it.
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("workflows: create by hand, schedule summary, pause, delete", async ({ page, seed }) => {
  const tag = Date.now().toString(36);
  const res = await page.request.post(`/api/workspaces/${seed.wsId}/agent-work/skills`, {
    data: { name: `Digest ${tag}`, instructions: "Summarise the selected tasks as a weekly digest.", command: `digest-${tag}`, parameters: [{ key: "period", label: "Kỳ", type: "date_range", default: "last_week", dateField: "completed" }] },
  });
  expect(res.status(), await res.text()).toBe(201);

  await page.goto(`/w/${seed.slug}/agent-work`);
  await page.getByRole("tab", { name: /^Workflow/ }).click();
  await page.getByTestId("wf-new").click();
  const dialog = page.getByTestId("wf-dialog");
  await dialog.getByTestId("wf-manual").click();
  await dialog.getByTestId("wf-name").fill(`Báo cáo thứ Hai ${tag}`);
  await dialog.getByTestId("wf-skill").selectOption({ label: `/digest-${tag} - Digest ${tag}` });
  await expect(dialog.getByTestId("run-param-period")).toHaveValue("last_week");
  await dialog.getByTestId("wf-freq").selectOption("weekly");
  await dialog.getByTestId("wf-hour").selectOption("8");
  await expect(dialog.getByTestId("wf-summary")).toHaveText(/T2.*08:00|Mon.*08:00/);
  await dialog.getByTestId("wf-save").click();

  const row = page.getByTestId("wf-row").filter({ hasText: `Báo cáo thứ Hai ${tag}` });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("wf-schedule")).toHaveText(/T2.*08:00|Mon.*08:00/);
  await expect(row).toContainText(/Lần tới|Next/);

  await row.getByRole("switch").click();
  await expect(row).not.toContainText(/Lần tới|Next/);

  page.once("dialog", (d) => void d.accept());
  await row.getByTestId("wf-delete").click();
  await expect(row).toHaveCount(0);
});
