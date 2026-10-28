// Every main screen fits a phone: nothing scrolls sideways by accident, no text is cut off
// or squeezed. Runs on an iPhone and an Android viewport (see playwright.config.ts).
import { AUTH_FILE, expect, layoutProblems, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

const screens = (s: { slug: string; projectId: string; taskId: string; dashId: string }) => {
  const w = `/w/${s.slug}`;
  const p = `${w}/p/${s.projectId}`;
  return {
    home: w,
    all: `${w}/apps`,
    "my-work": `${w}/my-work`,
    "action center": `${w}/inbox`,
    project: p,
    "task panel": `${p}?record=${s.taskId}`,
    "task page": `${p}/t/${s.taskId}`,
    "project settings": `${p}/settings`,
    "project objectives": `${p}/objectives`,
    dashboard: `${w}/dash/${s.dashId}`,
    dashboards: `${w}/dashboards`,
    recognition: `${w}/recognition`,
    okrs: `${w}/okrs`,
    "okr dashboard": `${w}/okrs/dashboard`,
    wiki: `${w}/wiki`,
    ai: `${w}/ai`,
    brain: `${w}/brain`,
    "agent work": `${w}/agent-work`,
    settings: `${w}/settings`,
    help: `${w}/help`,
  };
};

test("every main screen fits the phone", async ({ page, seed }) => {
  test.slow();
  const failures: string[] = [];
  for (const [name, url] of Object.entries(screens(seed))) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    for (const problem of await layoutProblems(page)) failures.push(`${name}: ${problem}`);
  }
  expect(failures).toEqual([]);
});

test("My work tabs fit the phone", async ({ page, seed }) => {
  await page.goto(`/w/${seed.slug}/my-work`);
  await page.waitForLoadState("networkidle");
  const failures: string[] = [];
  for (const tab of ["capture", "tasks", "okrs", "krs", "eisenhower", "deadlines"]) {
    await page.locator(`[role=tab][id$="-${tab}"]`).click();
    await page.waitForLoadState("networkidle");
    // The seeded tasks are assigned to this user: the check must run on real rows, not an empty list.
    if (tab === "tasks") await expect(page.getByText("Soạn email hướng dẫn nhân viên", { exact: false }).first()).toBeVisible();
    for (const problem of await layoutProblems(page)) failures.push(`${tab}: ${problem}`);
  }
  expect(failures).toEqual([]);
});

test("the notification panel fits the phone", async ({ page, seed }) => {
  await page.goto(`/w/${seed.slug}/apps`);
  await page.getByTestId("notif-bell").first().click();
  await expect(page.getByRole("dialog").first()).toBeVisible();
  expect(await layoutProblems(page)).toEqual([]);
});
