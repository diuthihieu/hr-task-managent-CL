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
  const second = (await res.json()) as { slug: string; name: string };

  await page.goto(`/w/${second.slug}`);
  await expect(page).toHaveURL(new RegExp(`/w/${second.slug}$`));
  await page.goto("/");
  await expect(page, "site root -> the workspace last open, on Home").toHaveURL(new RegExp(`/w/${second.slug}$`));
  await page.goto("/workspaces?source=app");
  await expect(page, "installed app start -> same").toHaveURL(new RegExp(`/w/${second.slug}$`));

  await page.goto(`/w/${seed.slug}/my-work`);
  // The page that was open just before may still write its own workspace as it unloads: wait until the
  // remembered workspace settles on the one now open (a person never reopens woli within milliseconds).
  await expect.poll(async () => (await context.cookies()).find((c) => c.name === "woli_last_ws")?.value).toBe(seed.slug);
  await page.goto("/workspaces?resume=1");
  await expect(page, "follows the workspace opened last").toHaveURL(new RegExp(`/w/${seed.slug}$`));

  await page.goto("/workspaces");
  await expect(page, "switching workspace still shows the chooser").toHaveURL(/\/workspaces$/);

  // Client-side switches count too: switch workspace in the app, then Back (served from the router cache,
  // which may never reach the server) - reopening lands on the workspace shown last.
  await page.goto(`/w/${seed.slug}`);
  await page.getByTestId("workspace-switcher").click();
  await page.getByRole("menuitem", { name: second.name }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${second.slug}$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/w/${seed.slug}$`));
  await expect.poll(async () => (await context.cookies()).find((c) => c.name === "woli_last_ws")?.value).toBe(seed.slug);
  await page.goto("/workspaces?resume=1");
  await expect(page).toHaveURL(new RegExp(`/w/${seed.slug}$`));
});
