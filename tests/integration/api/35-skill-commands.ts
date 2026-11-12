import { test } from "node:test";
import assert from "node:assert/strict";
import { admin, viewer, s, prisma } from "./context";

// Skills run by "/command": unique per workspace, arguments checked against what the caller may see,
// the run reads only the selected visible tasks, and a run stuck for over an hour is closed.
test("skill commands: unique, validated, permission-scoped, and stuck runs are closed", async () => {
  const base = `/api/workspaces/${s.ws}/agent-work`;
  const visible = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "CMD Visible" })).body.id;
  const hidden = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "CMD Hidden" })).body.id;
  await prisma.projectHiddenMember.create({ data: { projectId: hidden, userId: s.viewerId } });
  const done = (await prisma.status.findFirstOrThrow({ where: { workspaceId: s.ws, category: "done" } })).id;
  const completedAt = new Date().toISOString();
  for (const [p, title] of [[visible, "CMD visible task"], [hidden, "CMD secret task"]] as const) {
    const r = await admin.post(`/api/projects/${p}/tasks`, { data: { sys_title: title, sys_assignees: [s.viewerId], sys_actual: 2, sys_status: done, sys_completed_at: completedAt } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
  }

  const skill = {
    name: "Weekly HR digest",
    instructions: "Summarise the selected tasks as a short weekly digest with a table of hours.",
    visibility: "organization",
    command: "Weekly-Digest",
    parameters: [
      { key: "period", label: "Period", type: "date_range", default: "this_week", dateField: "completed" },
      { key: "projects", label: "Projects", type: "projects" },
      { key: "people", label: "People", type: "people", default: "me" },
      { key: "focus", label: "Focus", type: "text" },
    ],
  };
  const created = await admin.post<{ id: string }>(`${base}/skills`, skill);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await prisma.agentSkill.findUniqueOrThrow({ where: { id: created.body.id } })).command, "weekly-digest", "stored lower-case");
  assert.equal((await admin.post(`${base}/skills`, { ...skill, name: "Copy" })).status, 400, "a command is unique in the workspace");
  assert.equal((await admin.post(`${base}/skills`, { ...skill, name: "Bad", command: "báo cáo" })).status, 400, "only a-z, 0-9 and dashes");
  assert.equal((await admin.post(`${base}/skills`, { ...skill, name: "Dup keys", command: "dup-keys", parameters: [skill.parameters[1], skill.parameters[1]] })).status, 400);

  const list = await viewer.get<{ command: string }[]>(`${base}/commands`);
  assert.equal(list.status, 200);
  assert.ok(list.body.some((c) => c.command === "weekly-digest"), "an organisation Skill is offered to members");

  const bad = await viewer.post<{ error: string }>(`${base}/commands`, { command: "weekly-digest", args: { projects: [hidden] } });
  assert.equal(bad.status, 400, "a hidden project can't be passed as an argument");
  assert.match(bad.body.error, /not found or not visible/);
  assert.equal((await viewer.post(`${base}/commands`, { command: "weekly-digest", args: { period: { from: "2026-12-01", to: "2026-11-01" } } })).status, 400, "start after end");
  assert.equal((await viewer.post(`${base}/commands`, { command: "no-such-skill" })).status, 404);

  // No project argument: every project the viewer may see - the hidden one's task never reaches the model.
  type Run = { run: { id: string; status: string; originType: string; outputs: { id: string }[] }; content?: string };
  const ran = await viewer.post<Run>(`${base}/commands`, { command: "weekly-digest", note: "focus on hours" });
  assert.equal(ran.status, 200, JSON.stringify(ran.body));
  assert.equal(ran.body.run.status, "completed");
  assert.equal(ran.body.run.originType, "command");
  assert.ok(ran.body.run.outputs.length >= 1, "the result is saved as an output");
  assert.match(ran.body.content ?? "", /CMD visible task/, "the stub echoes the DATA it was given");
  assert.doesNotMatch(ran.body.content ?? "", /CMD secret task/, "hidden project tasks are never read");
  assert.match(ran.body.content ?? "", /weekly-digest: focus on hours/);

  // A sensitive request pauses for approval instead of running.
  const sensitive = await viewer.post<Run>(`${base}/commands`, { command: "weekly-digest", note: "include salary and payroll details" });
  assert.equal(sensitive.status, 200, JSON.stringify(sensitive.body));
  assert.equal(sensitive.body.run.status, "waiting_approval");
  const viaText = await viewer.post<Run>(`${base}/commands`, { command: "weekly-digest", args: { focus: "salary bands" } });
  assert.equal(viaText.body.run.status, "waiting_approval", "a text argument is checked like the note");

  // A run left in "running" for over an hour is closed when Agent Work is opened.
  await prisma.agentRun.update({ where: { id: ran.body.run.id }, data: { status: "running" } });
  await prisma.$executeRaw`UPDATE agent_runs SET updated_at = now() - interval '2 hours' WHERE id = ${ran.body.run.id}::uuid`;
  assert.equal((await viewer.get(base)).status, 200);
  const after = await prisma.agentRun.findUniqueOrThrow({ where: { id: ran.body.run.id }, select: { status: true, failureReason: true } });
  assert.equal(after.status, "failed");
  assert.match(after.failureReason ?? "", /within an hour/);
});
