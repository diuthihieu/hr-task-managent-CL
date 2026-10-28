import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma, admin, contributor, viewer, outsider, s, type Rec } from "./context";

test("goals: task-based key result progress is derived from linked tasks", async () => {
  const o = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/objectives`, { title: "Great onboarding", ownerId: s.contributorId });
  assert.equal(o.status, 201);
  const withKr = await admin.post<{ keyResults: { id: string }[] }>(`/api/objectives/${o.body.id}/key-results`, { title: "All day-one tasks done" });
  const kr = withKr.body.keyResults[0].id;
  assert.equal((await admin.post(`/api/key-results/${kr}/tasks`, { taskId: s.task1 })).status, 201);
  assert.equal((await admin.post(`/api/key-results/${kr}/tasks`, { taskId: s.task2 })).status, 201);
  await admin.patch(`/api/tasks/${s.task1}`, { data: { sys_progress: 100 } });
  const obj = await admin.get<{ progress: number; keyResults: { progress: number; tasks: unknown[] }[] }>(`/api/objectives/${o.body.id}`);
  assert.equal(obj.body.keyResults[0].tasks.length, 2);
  assert.equal(obj.body.keyResults[0].progress, 50);
  assert.equal(obj.body.progress, 50);
  // Contributor is the owner, so it shows in their My Work.
  const mine = await contributor.get<{ objectives: { id: string }[]; tasks: { taskId: string }[] }>(`/api/workspaces/${s.ws}/my-work`);
  assert.ok(mine.body.objectives.some((x) => x.id === o.body.id));
  assert.ok(mine.body.tasks.some((t) => t.taskId === s.task1));
});

test("project objectives: tasks link to an objective or a key result and roll up progress", async () => {
  // No objectives yet -> no Objective field on the task table.
  let detail = await admin.get<{ fields: { id: string; type: string; config: string }[] }>(`/api/projects/${s.project}`);
  assert.ok(!detail.body.fields.some((f) => f.id === "sys_objective"));

  const o = await admin.post<{ id: string; projectId: string; keyResults: { id: string; title: string }[] }>(`/api/workspaces/${s.ws}/objectives`, {
    title: "Smooth first week",
    projectId: s.project,
    ownerId: s.viewerId,
    keyResults: [{ title: "Laptop ready on day one" }, { title: "Buddy assigned", ownerId: s.contributorId }],
  });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  assert.equal(o.body.projectId, s.project);
  assert.equal(o.body.keyResults.length, 2, "key results created with the objective");
  s.projObjective = o.body.id;
  s.krLaptop = o.body.keyResults[0].id;
  s.krBuddy = o.body.keyResults[1].id;
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/objectives`, { title: "Nope", projectId: s.project })).status, 403);

  detail = await admin.get(`/api/projects/${s.project}`);
  const field = detail.body.fields.find((f) => f.id === "sys_objective");
  assert.ok(field, "Objective field appears once the project has objectives");
  assert.equal(field!.type, "okr_target");
  const cfg = JSON.parse(field!.config) as { objectives: { id: string; keyResults: { id: string }[] }[] };
  assert.equal(cfg.objectives[0].keyResults.length, 2);

  // Pick a key result: the task lands on that branch (and its objective).
  const t1 = await admin.patch<Rec>(`/api/tasks/${s.task1}`, { data: { sys_objective: `kr:${s.krLaptop}` } });
  assert.equal(t1.status, 200, JSON.stringify(t1.body));
  assert.equal(t1.body.data.sys_objective, `kr:${s.krLaptop}`);
  let row = await prisma.task.findUniqueOrThrow({ where: { id: s.task1 } });
  assert.equal(row.keyResultId, s.krLaptop);
  assert.equal(row.objectiveId, s.projObjective);
  // Pick the objective directly.
  assert.equal((await admin.patch(`/api/tasks/${s.task2}`, { data: { sys_objective: `obj:${s.projObjective}` } })).status, 200);
  row = await prisma.task.findUniqueOrThrow({ where: { id: s.task2 } });
  assert.equal(row.keyResultId, null);
  assert.equal(row.objectiveId, s.projObjective);
  assert.equal((await admin.patch(`/api/tasks/${s.task2}`, { data: { sys_objective: "kr:00000000-0000-0000-0000-000000000000" } })).status, 400);
  // The database refuses a key result that doesn't belong to the task's objective.
  const otherObj = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/objectives`, { title: "Unrelated" });
  await assert.rejects(prisma.task.update({ where: { id: s.task1 }, data: { objectiveId: otherObj.body.id } }), /key result must belong to the task objective/);

  const obj = await admin.get<{ progress: number; tasks: { taskId: string }[]; keyResults: { id: string; tasks: { taskId: string }[] }[] }>(`/api/objectives/${s.projObjective}`);
  assert.deepEqual(obj.body.keyResults.find((k) => k.id === s.krLaptop)!.tasks.map((x) => x.taskId), [s.task1]);
  assert.deepEqual(obj.body.tasks.map((x) => x.taskId), [s.task2], "objective-level tasks listed separately");

  // Team OKRs list every objective (project + workspace level), filterable by project.
  const team = await viewer.get<{ id: string; project: { id: string } | null }[]>(`/api/workspaces/${s.ws}/objectives`);
  assert.ok(team.body.some((x) => x.id === s.projObjective && x.project?.id === s.project));
  const onlyProject = await viewer.get<{ id: string }[]>(`/api/workspaces/${s.ws}/objectives?projectId=${s.project}`);
  assert.deepEqual(onlyProject.body.map((x) => x.id), [s.projObjective]);

  // Custom range: objectives whose period (own dates, else the cycle label) overlaps from..to.
  const q3 = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/objectives`, { title: "Q3 by label", cycleType: "quarter", cycleLabel: "Q3 2031" });
  const spring = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/objectives`, { title: "Spring push", cycleType: "custom", startDate: "2031-03-10", endDate: "2031-05-20" });
  const ids = async (qs: string) => (await viewer.get<{ id: string }[]>(`/api/workspaces/${s.ws}/objectives?${qs}`)).body.map((x) => x.id);
  assert.deepEqual(await ids("from=2031-09-30&to=2031-10-31"), [q3.body.id], "inclusive on the quarter's last day");
  assert.deepEqual(await ids("from=2031-05-20&to=2031-05-20"), [spring.body.id]);
  assert.deepEqual((await ids("from=2031-12-31&to=2031-01-01")).sort(), [q3.body.id, spring.body.id].sort(), "a reversed range is swapped");
  assert.ok((await ids("from=nope&to=2031-02-31")).length >= 3, "junk dates are ignored, not an error");
  const dash = await viewer.get<{ total: number; progressByProject: unknown[] }>(`/api/workspaces/${s.ws}/okr-dashboard?from=2031-03-01&to=2031-03-31`);
  assert.equal(dash.body.total, 1);
  // Teams are retired: the endpoint is gone and a team id is no longer stored.
  assert.equal((await admin.get(`/api/workspaces/${s.ws}/teams`)).status, 404);
  const withTeam = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/objectives`, { title: "Old client", teamId: "00000000-0000-0000-0000-000000000000" });
  assert.equal(withTeam.status, 201, "old clients sending teamId still work");
  assert.equal((await prisma.objective.findUniqueOrThrow({ where: { id: withTeam.body.id } })).teamId, null);
  assert.equal((await admin.post(`/api/projects/${s.project}/custom-fields`, { name: "Owning team", type: "team" })).status, 400, "no new team fields");
  await prisma.objective.deleteMany({ where: { id: { in: [q3.body.id, spring.body.id, withTeam.body.id] } } });
  // My OKRs: the viewer owns it, the contributor owns a key result.
  const viewerMine = await viewer.get<{ id: string }[]>(`/api/workspaces/${s.ws}/objectives?mine=1`);
  assert.ok(viewerMine.body.some((x) => x.id === s.projObjective));
  const contribMine = await contributor.get<{ id: string }[]>(`/api/workspaces/${s.ws}/objectives?mine=1`);
  assert.ok(contribMine.body.some((x) => x.id === s.projObjective));
});

test("cascading OKRs: a key result can become another person's objective", async () => {
  const child = await admin.post<{ id: string; parentKeyResult: { id: string; objectiveId: string } | null; parentObjectiveId: string | null }>(`/api/workspaces/${s.ws}/objectives`, {
    title: "Find a buddy for every new hire",
    ownerId: s.contributorId,
    parentKeyResultId: s.krBuddy,
  });
  assert.equal(child.status, 201, JSON.stringify(child.body));
  assert.equal(child.body.parentKeyResult?.id, s.krBuddy);
  assert.equal(child.body.parentObjectiveId, s.projObjective, "parent objective derived from the key result");
  s.childObjective = child.body.id;
  const parent = await admin.get<{ childObjectives: { id: string; parentKeyResultId: string }[] }>(`/api/objectives/${s.projObjective}`);
  assert.deepEqual(parent.body.childObjectives.map((c) => [c.id, c.parentKeyResultId]), [[s.childObjective, s.krBuddy]]);
  // No loops: the parent can't align to its own child's key result, nor to itself.
  const childKr = await admin.post<{ keyResults: { id: string }[] }>(`/api/objectives/${s.childObjective}/key-results`, { title: "10 buddies trained" });
  const loop = await admin.patch<{ error: string }>(`/api/objectives/${s.projObjective}`, { parentKeyResultId: childKr.body.keyResults[0].id });
  assert.equal(loop.status, 400);
  assert.equal((await admin.patch(`/api/objectives/${s.projObjective}`, { parentKeyResultId: s.krBuddy })).status, 400);
  // Deleting the parent key result keeps the child objective but drops the alignment.
  assert.equal((await admin.del(`/api/key-results/${s.krBuddy}`)).status, 200);
  const after = await prisma.objective.findUniqueOrThrow({ where: { id: s.childObjective } });
  assert.equal(after.parentKeyResultId, null);
  assert.equal(after.deletedAt, null);
});

test("OKR links never reach into a project hidden from the user, and linking needs the right to edit the task", async () => {
  const where = { workspaceId_userId: { workspaceId: s.ws, userId: s.contributorId } };
  const original = (await prisma.workspaceMember.findUniqueOrThrow({ where })).role;
  await prisma.workspaceMember.update({ where, data: { role: "editor" } });
  const objectives: string[] = [];
  const goal = async (body: Record<string, unknown>) => {
    const o = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/objectives`, body);
    assert.equal(o.status, 201, JSON.stringify(o.body));
    objectives.push(o.body.id);
    return o.body.id;
  };
  const kr = async (objectiveId: string, title: string) => (await admin.post<{ keyResults: { id: string; title: string }[] }>(`/api/objectives/${objectiveId}/key-results`, { title })).body.keyResults.find((k) => k.title === title)!.id;
  const hiddenTask = (await admin.post<{ id: string }>(`/api/projects/${s.otherProject}/tasks`, { data: { sys_title: "Hidden OKR task" } })).body.id;
  const narrowed = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Narrowed OKR project" })).body.id;
  try {
    const o1 = await goal({ title: "Workspace goal O1" });
    const k1 = await kr(o1, "K1 linked work");
    assert.equal((await admin.post(`/api/key-results/${k1}/tasks`, { taskId: hiddenTask })).status, 201);
    const o2 = await goal({ title: "Hidden child O2", projectId: s.otherProject, parentKeyResultId: k1 });
    const o3 = await goal({ title: "Hidden goal O3", projectId: s.otherProject });
    const k3 = await kr(o3, "K3 hidden");
    const o4 = await goal({ title: "Workspace goal O4", parentKeyResultId: k3 });
    await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.contributorId] });

    type Obj = { childObjectives: { id: string }[]; parentKeyResult: { id: string; objectiveTitle: string } | null; keyResults: { id: string; tasks: { taskId: string }[] }[] };
    const v1 = (await contributor.get<Obj>(`/api/objectives/${o1}`)).body;
    assert.ok(!v1.childObjectives.some((c) => c.id === o2), "a hidden project's objective isn't listed as a child");
    assert.ok(!v1.keyResults[0].tasks.some((t) => t.taskId === hiddenTask), "nor its task");
    assert.equal((await contributor.get<Obj>(`/api/objectives/${o4}`)).body.parentKeyResult, null, "a hidden parent key result isn't shown");
    // The edit dialog sends back the "no parent" it was shown: that must not drop the hidden alignment.
    assert.equal((await contributor.patch(`/api/objectives/${o4}`, { title: "Workspace goal O4 (renamed)", parentKeyResultId: null })).status, 200);
    const o4Row = await prisma.objective.findUniqueOrThrow({ where: { id: o4 } });
    assert.deepEqual([o4Row.title, o4Row.parentKeyResultId], ["Workspace goal O4 (renamed)", k3], "editing keeps the alignment the editor can't see");
    assert.equal((await contributor.del(`/api/key-results/${k1}/tasks/${hiddenTask}`)).status, 404, "a hidden task can't be unlinked");
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: hiddenTask } })).keyResultId, k1, "and stays linked");

    // Linking a task needs the right to edit it.
    const t = (await admin.post<{ id: string }>(`/api/projects/${narrowed}/tasks`, { data: { sys_title: "Narrowed task" } })).body.id;
    assert.equal((await admin.put(`/api/projects/${narrowed}/permissions`, { changes: [{ userId: s.contributorId, permissions: ["task.comment"] }] })).status, 200);
    assert.equal((await contributor.post(`/api/key-results/${k1}/tasks`, { taskId: t })).status, 403, "a narrowed editor can't re-link the task");
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: t } })).keyResultId, null);
  } finally {
    await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] });
    await prisma.workspaceMember.update({ where, data: { role: original } });
    for (const id of objectives.reverse()) await admin.del(`/api/objectives/${id}`);
    await admin.del(`/api/tasks/${hiddenTask}`);
    await prisma.projectMemberPermission.deleteMany({ where: { projectId: narrowed } });
    await admin.del(`/api/projects/${narrowed}`);
  }
});

test("record pages and wiki pages store sanitized rich content", async () => {
  const evil = '<p onclick="steal()">Hello <strong>team</strong><script>alert(1)</script><img src="https://evil.example/x.png"><a href="javascript:alert(1)">x</a></p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Done</p></div></li></ul>';
  const put = await contributor.put<{ content: string }>(`/api/tasks/${s.task1}/content`, { content: evil });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.ok(put.body.content.includes("<strong>team</strong>"));
  for (const bad of ["onclick", "<script", "evil.example", "javascript:"]) assert.ok(!put.body.content.includes(bad), `stripped ${bad}`);
  assert.ok(put.body.content.includes('data-checked="true"'), "checklists survive");
  assert.equal((await viewer.put(`/api/tasks/${s.task1}/content`, { content: "<p>x</p>" })).status, 403);
  assert.equal((await contributor.put(`/api/tasks/${s.task2}/content`, { content: "<p>x</p>" })).status, 403, "contributors: own/assigned tasks only");
  const got = await viewer.get<{ content: string }>(`/api/tasks/${s.task1}/content`);
  assert.equal(got.body.content, put.body.content);
  // Grid rows don't carry the page body.
  const rows = await viewer.get<Rec[]>(`/api/projects/${s.project}/tasks`);
  assert.ok(!JSON.stringify(rows.body).includes("<strong>team</strong>"));

  const wiki = await admin.post<{ id: string; myRole: string }>(`/api/workspaces/${s.ws}/wikis`, { name: "HR handbook" });
  assert.equal(wiki.status, 201);
  assert.equal(wiki.body.myRole, "manager");
  s.wiki = wiki.body.id;
  const page = await contributor.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, { title: "Onboarding checklist" });
  assert.equal(page.status, 201);
  const sub = await contributor.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, { title: "IT", parentPageId: page.body.id });
  assert.equal(sub.status, 201);
  assert.equal((await viewer.post(`/api/wikis/${s.wiki}/pages`, { title: "Nope" })).status, 403, "workspace viewers only read");
  const saved = await contributor.patch<{ content: string }>(`/api/wiki/${page.body.id}`, { content: '<h2>Day one</h2><iframe src="https://x"></iframe>' });
  assert.equal(saved.body.content, "<h2>Day one</h2>");
  assert.equal((await contributor.patch(`/api/wiki/${page.body.id}`, { parentPageId: sub.body.id })).status, 400, "no cycles in the page tree");
  assert.equal((await outsider.get(`/api/wiki/${page.body.id}`)).status, 404);
  const tree = await viewer.get<{ id: string; parentPageId: string | null }[]>(`/api/wikis/${s.wiki}/pages`);
  assert.equal(tree.body.length, 2);
  // Deleting a page soft-deletes its sub-pages too.
  assert.equal((await admin.del(`/api/wiki/${page.body.id}`)).status, 204);
  assert.equal((await viewer.get<unknown[]>(`/api/wikis/${s.wiki}/pages`)).body.length, 0);
  assert.equal(await prisma.wikiPage.count({ where: { wikiId: s.wiki, deletedAt: { not: null } } }), 2);
});

test("report views and personal preferences", async () => {
  const v = await admin.post<{ id: string; type: string }>(`/api/projects/${s.project}/views`, {
    name: "Hours report",
    type: "report",
    config: { report: { widgets: [{ id: "w1", title: "Hours by assignee", type: "bar", dimensionFieldId: "sys_assignees", measureFieldId: "sys_estimate", aggregation: "sum" }] } },
  });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.equal(v.body.type, "report");

  const prefs = await contributor.patch<{ locale: string; accentColor: string }>("/api/account/preferences", { locale: "vi", accentColor: "rose" });
  assert.equal(prefs.status, 200);
  assert.deepEqual([prefs.body.locale, prefs.body.accentColor], ["vi", "rose"]);
  assert.equal((await contributor.patch("/api/account/preferences", { accentColor: "not-a-color" })).status, 400);
  assert.equal((await contributor.patch("/api/account/preferences", { locale: "fr" })).status, 400);
});
