// Reopening woli: the session lasts 30 days (renewed while used), and the site root / the installed app
// land in the workspace last open on this device - Home on a computer. A plain /workspaces visit still
// shows the chooser.
import { AUTH_FILE, expect, test } from "./fixtures";

test.use({ storageState: AUTH_FILE });

test("stays signed in for weeks and reopens the workspace last used (Home)", async ({ page, context, seed }) => {
  const session = (await context.cookies()).find((c) => c.name.endsWith("authjs.session-token"));
  expect(session, "signed in").toBeTruthy();
  expect(session!.expires * 1000, "the session outlives a night, a weekend and a holiday").toBeGreaterThan(Date.now() + 20 * 86400_000);

  // A second workspace, so the landing comes from the remembered one, not from "your only workspace".
  const res = await page.request.post("/api/workspaces", { data: { name: `Resume ${Date.now()}` } });
  expect(res.ok(), `create workspace ${res.status()}`).toBeTruthy();
  const second = (await res.json()) as { slug: string };

  await page.goto(`/w/${second.slug}`);
  await expect(page).toHaveURL(new RegExp(`/w/${second.slug}$`));
  await page.goto("/");
  await expect(page, "site root -> the workspace last open, on Home").toHaveURL(new RegExp(`/w/${second.slug}$`));
  await page.goto("/workspaces?source=app");
  await expect(page, "installed app start -> same").toHaveURL(new RegExp(`/w/${second.slug}$`));

  await page.goto(`/w/${seed.slug}/my-work`);
  await page.goto("/workspaces?resume=1");
  await expect(page, "follows the workspace opened last").toHaveURL(new RegExp(`/w/${seed.slug}$`));

  await page.goto("/workspaces");
  await expect(page, "switching workspace still shows the chooser").toHaveURL(/\/workspaces$/);
});
