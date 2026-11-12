// A Skill with a /command and parameters: the card shows the command, Run opens a form with the
// parameter defaults, and the request carries the chosen arguments (AI is off in E2E, so the server
// answers that AI isn't configured - the form stays open with the values intact).
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("skill command: card shows /command, Run opens the parameter form and sends the arguments", async ({ page, seed }) => {
  const tag = Date.now().toString(36);
  const res = await page.request.post(`/api/workspaces/${seed.wsId}/agent-work/skills`, {
    data: {
      name: `Báo cáo tuần ${tag}`,
      instructions: "Summarise the selected tasks as a weekly digest with a table of hours.",
      command: `bao-cao-${tag}`,
      parameters: [
        { key: "period", label: "Kỳ báo cáo", type: "date_range", default: "last_week", dateField: "completed" },
        { key: "focus", label: "Trọng tâm", type: "text", default: "HR" },
      ],
    },
  });
  expect(res.status(), await res.text()).toBe(201);

  await page.goto(`/w/${seed.slug}/agent-work`);
  await page.getByRole("tab", { name: "Skills" }).click();
  const card = page.getByRole("button", { name: new RegExp(`Báo cáo tuần ${tag}`) });
  await expect(card.getByTestId("skill-card-command")).toHaveText(`/bao-cao-${tag}`);
  await card.getByTestId("skill-run").click();

  const dialog = page.getByTestId("skill-run-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("run-param-period")).toHaveValue("last_week");
  await expect(dialog.getByTestId("run-param-focus")).toHaveValue("HR");
  await dialog.getByTestId("run-param-period").selectOption("this_month");
  await dialog.getByTestId("run-note").fill("tập trung việc trễ hạn");

  const [req] = await Promise.all([page.waitForRequest((r) => r.url().endsWith("/agent-work/commands") && r.method() === "POST"), dialog.getByTestId("run-start").click()]);
  const body = req.postDataJSON() as { args: Record<string, unknown>; note: string };
  expect(body.args).toEqual({ period: "this_month", focus: "HR" });
  expect(body.note).toBe("tập trung việc trễ hạn");
  await expect(dialog.getByTestId("run-start")).toBeEnabled();
});
