import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma, admin, s, BASE } from "./context";

// BUG-12a (found while planning BUG-12): the Home page's "Recent activity" listed deleted tasks
// (title and link) and items of deleted projects, because its lookup by id had no deletedAt filter.
test("Home 'Recent activity' never shows deleted tasks or anything from a deleted project", async () => {
  const slug = (await prisma.workspace.findUniqueOrThrow({ where: { id: s.ws }, select: { slug: true } })).slug;
  const home = async () => (await fetch(`${BASE}/w/${slug}`, { headers: { cookie: admin.cookieHeader() } })).text();

  const gone = await admin.post<{ id: string }>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Deleted-task-ZQX" } });
  assert.equal(gone.status, 201);
  assert.match(await home(), /Deleted-task-ZQX/, "a live task shows in Recent activity");
  assert.equal((await admin.del(`/api/tasks/${gone.body.id}`)).status, 204);
  assert.doesNotMatch(await home(), /Deleted-task-ZQX/);

  const p = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Doomed project" });
  const t = await admin.post<{ id: string }>(`/api/projects/${p.body.id}/tasks`, { data: { sys_title: "In-deleted-project-ZQX" } });
  assert.equal(t.status, 201);
  const o = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/objectives`, { title: "Objective-in-deleted-project-ZQX", projectId: p.body.id });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.match(await home(), /In-deleted-project-ZQX/);
  assert.equal((await admin.del(`/api/projects/${p.body.id}`)).status, 204);
  const html = await home();
  assert.doesNotMatch(html, /In-deleted-project-ZQX/);
  assert.doesNotMatch(html, /Objective-in-deleted-project-ZQX/);
});
