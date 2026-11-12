import { test } from "node:test";
import assert from "node:assert/strict";
import { admin, viewer, s, prisma, BASE } from "./context";

// Scheduled workflows: a Skill run for its owner on a schedule (owner's permissions at run time),
// results in the owner's Woli AI inbox; the tick needs the cron secret, never runs one twice, and
// three failures in a row pause the workflow.
const tick = (auth?: string) => fetch(`${BASE}/api/workflows/tick?wait=1`, { method: "POST", headers: auth ? { Authorization: auth } : {} });

test("workflows: validated, owner-only, run by the tick into the Woli AI inbox, paused after 3 failures", async () => {
  const base = `/api/workspaces/${s.ws}/agent-work`;
  const hidden = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "WF Hidden" })).body.id;
  await prisma.projectHiddenMember.create({ data: { projectId: hidden, userId: s.viewerId } });
  const sk = await admin.post<{ id: string }>(`${base}/skills`, {
    name: "Weekly WF digest",
    instructions: "Summarise the selected tasks as a short weekly digest.",
    visibility: "organization",
    command: "wf-digest",
    parameters: [
      { key: "period", label: "Period", type: "date_range", default: "last_week", dateField: "completed" },
      { key: "projects", label: "Projects", type: "projects" },
    ],
  });
  assert.equal(sk.status, 201, JSON.stringify(sk.body));
  const weekly = { freq: "weekly", hour: 8, minute: 0, weekdays: [0] };

  type WF = { id: string; nextRunAt: string; active: boolean; lastStatus: string | null };
  assert.equal((await viewer.post(`${base}/workflows`, { name: "Leaky", skillId: sk.body.id, args: { projects: [hidden] }, schedule: weekly })).status, 400, "a hidden project can't be an argument");
  assert.equal((await viewer.post(`${base}/workflows`, { name: "Bad", skillId: sk.body.id, schedule: { freq: "weekly", weekdays: [] } })).status, 400);
  const created = await viewer.post<WF>(`${base}/workflows`, { name: "Monday digest", description: "Every Monday 8:00", skillId: sk.body.id, args: { period: "last_week" }, schedule: weekly });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const wf = created.body;
  assert.ok(new Date(wf.nextRunAt) > new Date());
  assert.ok((await viewer.get<WF[]>(`${base}/workflows`)).body.some((w) => w.id === wf.id));
  assert.ok(!(await admin.get<WF[]>(`${base}/workflows`)).body.some((w) => w.id === wf.id), "only the owner lists it");
  assert.equal((await admin.patch(`/api/agent-work/workflows/${wf.id}`, { active: false })).status, 404, "only the owner changes it");
  assert.equal((await admin.post(`/api/agent-work/workflows/${wf.id}/run`)).status, 404);

  const hourly = await viewer.patch<WF>(`/api/agent-work/workflows/${wf.id}`, { schedule: { freq: "hourly", minute: 30 } });
  assert.equal(hourly.status, 200);
  assert.ok(new Date(hourly.body.nextRunAt).getTime() - Date.now() <= 3_600_000, "the next run follows the new schedule");

  // At most 10 active per person.
  const extra: string[] = [];
  for (let i = 0; i < 9; i++) extra.push((await viewer.post<WF>(`${base}/workflows`, { name: `Extra ${i}`, skillId: sk.body.id, schedule: weekly })).body.id);
  assert.equal((await viewer.post(`${base}/workflows`, { name: "Eleventh", skillId: sk.body.id, schedule: weekly })).status, 400);
  assert.equal((await viewer.post(`${base}/workflows`, { name: "Paused one", skillId: sk.body.id, schedule: weekly, active: false })).status, 201, "a paused one is fine");
  await prisma.agentWorkflow.deleteMany({ where: { id: { in: extra } } });

  // The tick: secret required; runs what is due once, into the owner's inbox.
  assert.equal((await tick()).status, 401);
  assert.equal((await tick("Bearer wrong")).status, 401);
  await prisma.agentWorkflow.update({ where: { id: wf.id }, data: { nextRunAt: new Date(Date.now() - 60_000) } });
  const r1 = await tick(`Bearer ${process.env.CRON_SECRET}`);
  assert.equal(r1.status, 200);
  const ran = ((await r1.json()) as { ran: { id: string; status: string }[] }).ran;
  assert.deepEqual(ran.filter((x) => x.id === wf.id), [{ id: wf.id, status: "completed" }]);
  const after = await prisma.agentWorkflow.findUniqueOrThrow({ where: { id: wf.id } });
  assert.ok(after.nextRunAt > new Date() && after.lastStatus === "completed" && after.lockedUntil === null);
  const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: after.lastRunId! } });
  assert.deepEqual([run.userId, run.originId, run.status], [s.viewerId, wf.id, "completed"], "ran as the owner, linked to the workflow");
  const inbox = await prisma.conversation.findUniqueOrThrow({ where: { pairKey: `bot:${s.viewerId}` } });
  const posted = await prisma.chatMessage.findFirstOrThrow({ where: { conversationId: inbox.id }, orderBy: { createdAt: "desc" } });
  assert.match(posted.body, /Monday digest/);
  assert.equal(posted.authorId, null, "written by Woli AI");
  const usage = await prisma.aiUsageEvent.findFirst({ where: { feature: "agent-workflow" }, orderBy: { createdAt: "desc" } });
  assert.equal(usage?.userId, s.viewerId, "the AI call is counted against the owner, not left anonymous");
  const r2 = await tick(`Bearer ${process.env.CRON_SECRET}`);
  assert.ok(!((await r2.json()) as { ran: { id: string }[] }).ran.some((x) => x.id === wf.id), "not run twice");

  // Three failures in a row pause it and tell the owner.
  await prisma.agentSkill.update({ where: { id: sk.body.id }, data: { deletedAt: new Date() } });
  for (let i = 0; i < 3; i++) {
    const res = await viewer.post<{ status: string }>(`/api/agent-work/workflows/${wf.id}/run`);
    assert.equal(res.body.status, "failed");
  }
  const paused = await prisma.agentWorkflow.findUniqueOrThrow({ where: { id: wf.id } });
  assert.deepEqual([paused.active, paused.failureCount], [false, 3]);
  const notice = await prisma.chatMessage.findFirstOrThrow({ where: { conversationId: inbox.id }, orderBy: { createdAt: "desc" } });
  assert.match(notice.body, /paused/);
  await prisma.agentSkill.update({ where: { id: sk.body.id }, data: { deletedAt: null } });
  const back = await viewer.patch<WF>(`/api/agent-work/workflows/${wf.id}`, { active: true });
  assert.equal(back.status, 200);
  assert.equal((await prisma.agentWorkflow.findUniqueOrThrow({ where: { id: wf.id } })).failureCount, 0, "turning it back on forgets old failures");

  // AI draft: never trusts a Skill id the model invents.
  const d = await viewer.post<{ skillId: string | null }>(`${base}/workflows/draft`, { description: "Every Monday at 8 send me last week's digest" });
  assert.equal(d.status, 200);
  assert.ok(d.body.skillId === null || d.body.skillId === sk.body.id);

  assert.equal((await viewer.del(`/api/agent-work/workflows/${wf.id}`)).status, 200);
});
