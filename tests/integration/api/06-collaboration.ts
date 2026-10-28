import { test } from "node:test";
import assert from "node:assert/strict";
import { prisma, admin, contributor, viewer, outsider, s, ask, lastModelRequest, type NotifList, type Rec } from "./context";

test("comments: @mentions notify only people who can see the task", async () => {
  const t = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Prepare offer letters", sys_assignees: [s.contributorId] } });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  s.r6task = t.body.id;
  const people = await contributor.get<{ id: string }[]>(`/api/tasks/${s.r6task}/mentionable`);
  assert.ok(people.body.some((p) => p.id === s.viewerId));
  assert.ok(!people.body.some((p) => p.id === s.outsiderId), "outsiders can't be tagged");
  const c = await contributor.post<{ id: string }>(`/api/tasks/${s.r6task}/comments`, { body: `Please check @[Vic Viewer](${s.viewerId}) and @[Out](${s.outsiderId})` });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  const rows = await prisma.commentMention.findMany({ where: { commentId: c.body.id } });
  assert.deepEqual(rows.map((r) => r.userId), [s.viewerId]);
  const inbox = await viewer.get<NotifList>("/api/notifications?view=todo");
  assert.ok(inbox.body.items.some((n) => n.type === "mention" && n.taskId === s.r6task));
  assert.equal(await prisma.notification.count({ where: { userId: s.outsiderId, type: "mention" } }), 0);
});

test("action center: snooze hides an item, done clears it, due-date changes reach the assignee", async () => {
  const inbox = await viewer.get<NotifList>("/api/notifications?view=todo");
  const n = inbox.body.items.find((x) => x.type === "mention")!;
  const later = new Date(Date.now() + 3600_000).toISOString();
  assert.equal((await viewer.patch(`/api/notifications/${n.id}`, { snoozeUntil: later })).status, 200);
  assert.ok(!(await viewer.get<NotifList>("/api/notifications?view=todo")).body.items.some((x) => x.id === n.id), "snoozed items leave To do");
  assert.ok((await viewer.get<NotifList>("/api/notifications?view=snoozed")).body.items.some((x) => x.id === n.id));
  await viewer.patch(`/api/notifications/${n.id}`, { snoozeUntil: null, actioned: true });
  assert.ok(!(await viewer.get<NotifList>("/api/notifications?view=todo")).body.items.some((x) => x.id === n.id), "done items leave To do");
  assert.ok((await viewer.get<NotifList>("/api/notifications?view=all")).body.items.some((x) => x.id === n.id && x.actioned));
  assert.equal((await outsider.patch(`/api/notifications/${n.id}`, { read: true })).status, 404, "someone else's notification");

  await admin.patch(`/api/tasks/${s.r6task}`, { data: { sys_due_date: "2031-03-15" } });
  const due = await prisma.notification.findFirst({ where: { userId: s.contributorId, taskId: s.r6task, type: "task_due_changed" } });
  assert.ok(due, "assignee told about the new deadline");
  assert.equal((due!.data as { date: string }).date, "2031-03-15");
});

test("quick actions: start / plan / complete follow the same permissions as edits", async () => {
  assert.equal((await viewer.post(`/api/tasks/${s.r6task}/quick`, { action: "start" })).status, 403, "viewers can't edit");
  const started = await contributor.post<Rec>(`/api/tasks/${s.r6task}/quick`, { action: "start" });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const plan = await contributor.post<Rec>(`/api/tasks/${s.r6task}/quick`, { action: "plan" });
  assert.equal(plan.body.data.sys_start_date, new Date().toISOString().slice(0, 10));
  const task = await prisma.task.findUniqueOrThrow({ where: { id: s.r6task }, include: { status: true } });
  assert.equal(task.status.category, "in_progress");
});

test("focus sessions: one running session at a time; completing adds the minutes to actual hours", async () => {
  const a = await contributor.post<{ id: string; status: string; plannedMinutes: number }>(`/api/tasks/${s.r6task}/focus`, {});
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.status, "running");
  const other = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Second focus task", sys_assignees: [s.contributorId] } });
  const b = await contributor.post<{ id: string }>(`/api/tasks/${other.body.id}/focus`, {});
  assert.equal((await prisma.focusSession.findUniqueOrThrow({ where: { id: a.body.id } })).status, "paused", "starting another one pauses the first");
  assert.equal((await contributor.patch(`/api/focus/${b.body.id}`, { action: "cancel" })).status, 200);
  await contributor.patch(`/api/focus/${a.body.id}`, { action: "resume" });
  assert.equal((await viewer.patch(`/api/focus/${a.body.id}`, { action: "pause" })).status, 404, "only the owner");
  // 25 minutes focused.
  await prisma.focusSession.update({ where: { id: a.body.id }, data: { elapsedSeconds: 25 * 60, resumedAt: new Date() } });
  const done = await contributor.patch<{ status: string }>(`/api/focus/${a.body.id}`, { action: "complete", notes: "Drafted 3 letters" });
  assert.equal(done.body.status, "completed");
  const task = await prisma.task.findUniqueOrThrow({ where: { id: s.r6task } });
  assert.ok(task.actualMinutes! >= 25 && task.actualMinutes! <= 26, `actual minutes ${task.actualMinutes}`);
  const grid = await contributor.get<Rec[]>(`/api/projects/${s.project}/tasks`);
  const rec = grid.body.find((r) => r.id === s.r6task)!;
  assert.ok(Number(rec.data.sys_actual) >= 0.4, "shown as hours in the grid");
});

test("focus: switching tasks pauses and records the running one; all open sessions are listed; stop keeps the time", async () => {
  const mk = async (title: string) => (await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: title, sys_assignees: [s.contributorId] } })).body.id;
  const [t1, t2] = [await mk("Focus flow A"), await mk("Focus flow B")];
  const cat = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id }, include: { status: true } })).status.category;
  const actual = async (id: string) => (await prisma.task.findUniqueOrThrow({ where: { id } })).actualMinutes ?? 0;
  assert.equal(await cat(t1), "todo");
  const a = await contributor.post<{ id: string }>(`/api/tasks/${t1}/focus`, {});
  assert.equal(await cat(t1), "in_progress", "focusing starts the task");
  await prisma.focusSession.update({ where: { id: a.body.id }, data: { elapsedSeconds: 0, resumedAt: new Date(Date.now() - 10 * 60_000) } });
  const b = await contributor.post<{ id: string }>(`/api/tasks/${t2}/focus`, {});
  assert.equal((await prisma.focusSession.findUniqueOrThrow({ where: { id: a.body.id } })).status, "paused");
  assert.equal(await actual(t1), 10, "the paused task's time is recorded right away");
  const open = await contributor.get<{ id: string; status: string; running: boolean }[]>("/api/focus/active?all=1");
  assert.deepEqual(open.body.map((x) => [x.id, x.status]), [[b.body.id, "running"], [a.body.id, "paused"]], "running first, then paused");
  // Focusing on a task that already has a paused session resumes it (no duplicate).
  const again = await contributor.post<{ id: string; status: string }>(`/api/tasks/${t1}/focus`, {});
  assert.equal(again.body.id, a.body.id);
  assert.equal(again.body.status, "running");
  assert.equal((await prisma.focusSession.findUniqueOrThrow({ where: { id: b.body.id } })).status, "paused");
  // Stop (not complete): time counted, task stays in progress, nothing double-counted.
  await prisma.focusSession.update({ where: { id: a.body.id }, data: { resumedAt: new Date(Date.now() - 5 * 60_000) } });
  assert.equal((await contributor.patch(`/api/focus/${a.body.id}`, { action: "cancel" })).status, 200);
  assert.equal(await actual(t1), 15);
  assert.equal(await cat(t1), "in_progress");
  assert.equal((await contributor.patch(`/api/focus/${b.body.id}`, { action: "complete" })).status, 200);
  assert.equal(await actual(t1), 15, "completing another session doesn't touch this task");
  assert.deepEqual((await contributor.get<unknown[]>("/api/focus/active?all=1")).body, []);
  // Every start / resume and how it ended is logged with its times.
  const runs = await prisma.focusRun.findMany({ where: { sessionId: a.body.id }, orderBy: { startedAt: "asc" } });
  assert.deepEqual(runs.map((r) => [r.startKind, r.endKind]), [["started", "switched"], ["resumed", "stopped"]]);
  assert.ok(runs.every((r) => r.endedAt && r.endedAt >= r.startedAt));
  const hist = await contributor.get<{ sessions: { id: string; startedAt: string; endedAt: string | null; runs: { startKind: string; endKind: string; startedAt: string; endedAt: string }[] }[] }>(`/api/tasks/${t1}/focus`);
  const sess = hist.body.sessions.find((x) => x.id === a.body.id)!;
  assert.equal(sess.runs.length, 2);
  assert.ok(sess.endedAt, "the session's end time");
  const bRuns = await prisma.focusRun.findMany({ where: { sessionId: b.body.id }, orderBy: { startedAt: "asc" } });
  assert.deepEqual(bRuns.map((r) => [r.startKind, r.endKind]), [["started", "switched"]], "completing a paused session adds no run");
});

test("role changes: the member is notified, may decline a promotion (never a demotion), and the admin hears back", async () => {
  const latest = async () => prisma.notification.findFirstOrThrow({ where: { userId: s.viewerId, type: "role_changed" }, orderBy: { createdAt: "desc" } });
  assert.equal((await admin.patch(`/api/workspaces/${s.ws}/members/${s.viewerId}`, { role: "editor" })).status, 200);
  const up = await latest();
  assert.deepEqual(up.data, { from: "viewer", to: "editor" });
  assert.equal((await contributor.post(`/api/notifications/${up.id}/role-response`, { decision: "decline" })).status, 404, "only the person concerned");
  const declined = await viewer.post<{ role: string }>(`/api/notifications/${up.id}/role-response`, { decision: "decline" });
  assert.equal(declined.status, 200, JSON.stringify(declined.body));
  assert.equal(declined.body.role, "viewer");
  assert.equal((await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: s.ws, userId: s.viewerId } })).role, "viewer");
  assert.equal((await viewer.post(`/api/notifications/${up.id}/role-response`, { decision: "decline" })).status, 409, "answered once");
  const back = await prisma.notification.findFirstOrThrow({ where: { type: "role_change_result", actorId: s.viewerId }, orderBy: { createdAt: "desc" } });
  assert.equal((back.data as { decision: string }).decision, "declined");

  // A stale promotion (role changed again since) or a demotion can't be declined.
  await admin.patch(`/api/workspaces/${s.ws}/members/${s.viewerId}`, { role: "contributor" });
  const promo = await latest();
  await admin.patch(`/api/workspaces/${s.ws}/members/${s.viewerId}`, { role: "viewer" });
  const demo = await latest();
  assert.equal((await viewer.post(`/api/notifications/${promo.id}/role-response`, { decision: "decline" })).status, 409);
  assert.equal((await viewer.post(`/api/notifications/${demo.id}/role-response`, { decision: "decline" })).status, 400);
  assert.equal((await viewer.post(`/api/notifications/${demo.id}/role-response`, { decision: "accept" })).status, 200, "a demotion can be acknowledged");
  assert.equal((await prisma.workspaceMember.findFirstOrThrow({ where: { workspaceId: s.ws, userId: s.viewerId } })).role, "viewer");
  // Changing your own role (or no change) sends nothing.
  const before = await prisma.notification.count({ where: { type: "role_changed" } });
  await admin.patch(`/api/workspaces/${s.ws}/members/${s.viewerId}`, { role: "viewer" });
  assert.equal(await prisma.notification.count({ where: { type: "role_changed" } }), before);
});

test("email setup is visible to system admins only; a missing provider is reported, not faked", async () => {
  assert.equal((await contributor.get("/api/admin/mail")).status, 403);
  const st = await admin.get<{ configured: boolean; missing: string[] }>("/api/admin/mail");
  assert.equal(st.status, 200);
  assert.equal(st.body.configured, false);
  assert.deepEqual(st.body.missing, ["SMTP_HOST + SMTP_USER + SMTP_PASS (or RESEND_API_KEY)", "MAIL_FROM"]);
  const test = await admin.post<{ ok: boolean; error: string }>("/api/admin/mail", {});
  assert.equal(test.body.ok, false);
  assert.match(test.body.error, /missing SMTP_HOST \+ SMTP_USER \+ SMTP_PASS \(or RESEND_API_KEY\)/);
});

test("renames: mentions show the current name, the AI knows former names; replies to replies join the thread", async () => {
  const old = (await prisma.user.findUniqueOrThrow({ where: { id: s.viewerId } })).name;
  assert.equal((await viewer.patch("/api/account/profile", { name: "Vivi Renamed" })).status, 200);
  assert.deepEqual((await prisma.user.findUniqueOrThrow({ where: { id: s.viewerId } })).formerNames, [old], "the old name is kept by the database");
  try {
    const root = await contributor.post<{ id: string }>(`/api/tasks/${s.r6task}/comments`, { body: `@[${old}](${s.viewerId}) please check` });
    assert.equal(root.status, 201, JSON.stringify(root.body));
    const r1 = await admin.post<{ id: string }>(`/api/tasks/${s.r6task}/comments`, { body: "on it", parentCommentId: root.body.id });
    const r2 = await contributor.post<{ id: string; parentCommentId: string }>(`/api/tasks/${s.r6task}/comments`, { body: "thanks", parentCommentId: r1.body.id });
    assert.equal(r2.status, 201);
    assert.equal(r2.body.parentCommentId, root.body.id, "a reply to a reply joins the root thread");
    const list = await contributor.get<{ id: string; body: string }[]>(`/api/tasks/${s.r6task}/comments`);
    assert.equal(list.body.find((c) => c.id === root.body.id)?.body, `@[Vivi Renamed](${s.viewerId}) please check`, "mentions show the current name");
    const a = await ask(admin, { kind: "assistant", workspaceId: s.ws, message: `What is ${old} working on?` });
    assert.equal(a.status, 200, a.text);
    const system = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
    assert.ok(system.includes(`Vivi Renamed | ${old} |`), "current name with the former one");
    assert.match(system, /refers to the same person/);
  } finally {
    await viewer.patch("/api/account/profile", { name: old });
  }
});

test("quick capture dots move along their ring and can be deleted by their owner only", async () => {
  const th = await contributor.post<{ id: string }>(`/api/workspaces/${s.ws}/thoughts`, { taskName: "Orbit me", projectId: s.project, plannedAt: new Date(Date.now() + 10 * 86400000).toISOString() });
  assert.equal(th.status, 201, JSON.stringify(th.body));
  assert.equal((await contributor.patch<{ orbitAngle: number }>(`/api/thoughts/${th.body.id}`, { orbitAngle: 400 })).body.orbitAngle, 40, "angles wrap to 0-360");
  assert.equal((await admin.patch(`/api/thoughts/${th.body.id}`, { orbitAngle: 10 })).status, 404, "captures are personal");
  const rows = await contributor.get<{ id: string; orbitAngle: number | null; plannedAt: string }[]>(`/api/workspaces/${s.ws}/thoughts`);
  assert.equal(rows.body.find((r) => r.id === th.body.id)?.orbitAngle, 40);
  assert.equal((await admin.del(`/api/thoughts/${th.body.id}`)).status, 404);
  assert.equal((await contributor.del(`/api/thoughts/${th.body.id}`)).status, 204);
  assert.ok(!(await contributor.get<{ id: string }[]>(`/api/workspaces/${s.ws}/thoughts`)).body.some((r) => r.id === th.body.id));
});

test("Home: personal layouts, validated widgets, and templates shared within the workspace", async () => {
  const def = await viewer.get<{ widgets: { type: string }[]; custom: boolean }>(`/api/workspaces/${s.ws}/home-layout`);
  assert.equal(def.body.custom, false);
  assert.equal(def.body.widgets[0].type, "kpis", "the default command-center layout");
  assert.equal((await viewer.put(`/api/workspaces/${s.ws}/home-layout`, { widgets: [{ id: "x1", type: "hack", size: "s", style: "x" }] })).status, 400);
  const saved = await viewer.put<{ widgets: { type: string; size: string; style: string }[] }>(`/api/workspaces/${s.ws}/home-layout`, { widgets: [{ id: "m1", type: "metric", size: "xl", style: "weird", config: { metric: "overdue" } }, { id: "n1", type: "note", size: "s", style: "sticky", config: { text: "Call payroll" } }] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.widgets.map((w) => [w.type, w.size, w.style]), [["metric", "s", "tile"], ["note", "s", "sticky"]], "unsupported sizes / styles fall back to defaults");
  assert.equal((await contributor.get<{ custom: boolean }>(`/api/workspaces/${s.ws}/home-layout`)).body.custom, false, "layouts are personal");
  assert.equal((await outsider.get(`/api/workspaces/${s.ws}/home-layout`)).status, 404);

  const widgets = [{ id: "k", type: "kpis", size: "xl", style: "big" }, { id: "t", type: "my_tasks", size: "xl", style: "list" }];
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/home-templates`, { name: "Board", widgets, visibility: "workspace" })).status, 403, "viewers can't publish to everyone");
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/home-templates`, { name: "Board", widgets, visibility: "shared", shareWith: [s.outsiderId] })).status, 400, "only members");
  const shared = await viewer.post<{ id: string; visibility: string }>(`/api/workspaces/${s.ws}/home-templates`, { name: "HR daily", widgets, visibility: "shared", shareWith: [s.contributorId] });
  assert.equal(shared.status, 201, JSON.stringify(shared.body));
  const priv = await viewer.post<{ id: string }>(`/api/workspaces/${s.ws}/home-templates`, { name: "Just me", widgets });
  const pub = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/home-templates`, { name: "Company", widgets, visibility: "workspace" });
  assert.equal(pub.status, 201);
  const seen = await contributor.get<{ mine: { id: string }[]; shared: { id: string; sharedWith: unknown[] }[] }>(`/api/workspaces/${s.ws}/home-templates`);
  const ids = seen.body.shared.map((x) => x.id);
  assert.ok(ids.includes(shared.body.id) && ids.includes(pub.body.id), "shared with me + workspace-wide");
  assert.ok(!ids.includes(priv.body.id), "private stays private");
  assert.deepEqual(seen.body.shared.find((x) => x.id === shared.body.id)?.sharedWith, [], "who else it is shared with is the owner's business");
  assert.ok(await prisma.notification.findFirst({ where: { userId: s.contributorId, type: "template_shared", actorId: s.viewerId } }), "recipients are notified");
  assert.equal((await contributor.patch(`/api/home-templates/${shared.body.id}`, { name: "Mine now" })).status, 404, "only the owner edits");
  assert.equal((await contributor.del(`/api/home-templates/${shared.body.id}`)).status, 403);
  const copy = await contributor.post<{ id: string; visibility: string }>(`/api/home-templates/${shared.body.id}/copy`);
  assert.equal(copy.status, 201);
  assert.equal(copy.body.visibility, "private", "a copy starts private");
  assert.equal((await outsider.post(`/api/home-templates/${shared.body.id}/copy`)).status, 404);
  assert.equal((await contributor.post(`/api/home-templates/${priv.body.id}/copy`)).status, 404);
  // Using a template counts its use; unsharing removes access.
  await contributor.put(`/api/workspaces/${s.ws}/home-layout`, { widgets, templateId: pub.body.id });
  assert.equal((await prisma.homeTemplate.findUniqueOrThrow({ where: { id: pub.body.id } })).useCount, 1);
  assert.equal((await viewer.patch(`/api/home-templates/${shared.body.id}`, { visibility: "private" })).status, 200);
  assert.ok(!(await contributor.get<{ shared: { id: string }[] }>(`/api/workspaces/${s.ws}/home-templates`)).body.shared.some((x) => x.id === shared.body.id));
  assert.equal((await admin.del(`/api/home-templates/${pub.body.id}`)).status, 204);
  assert.equal((await viewer.del(`/api/workspaces/${s.ws}/home-layout`)).status, 200);
});

test("journal notes: Save files a note in a private history", async () => {
  const saved = await viewer.post<{ id: string; title: string }>(`/api/workspaces/${s.ws}/journal/notes`, { date: "2026-09-30", content: "<p>Learned: <b>probation</b> is 60 days</p><script>x</script>" });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.title, "Learned: probation is 60 days");
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/journal/notes`, { date: "2026-09-30", content: "<p> </p>" })).status, 400);
  const day = await viewer.get<{ id: string; content: string }[]>(`/api/workspaces/${s.ws}/journal/notes?date=2026-09-30`);
  assert.equal(day.body.length, 1);
  assert.doesNotMatch(day.body[0].content, /script/, "sanitized");
  assert.equal((await contributor.get<unknown[]>(`/api/workspaces/${s.ws}/journal/notes`)).body.length, 0, "private to the author");
  assert.equal((await contributor.del(`/api/journal-notes/${saved.body.id}`)).status, 404);
  assert.equal((await viewer.del(`/api/journal-notes/${saved.body.id}`)).status, 204);
});

test("universal search covers tasks, projects, wikis, objectives and people - within what the user can see", async () => {
  const r = await admin.get<{ tasks: { id: string }[]; projects: unknown[]; people: { id: string }[]; objectives: unknown[] }>(`/api/search?workspaceId=${s.ws}&q=offer`);
  assert.ok(r.body.tasks.some((t) => t.id === s.r6task));
  const people = await admin.get<{ people: { id: string }[] }>(`/api/search?workspaceId=${s.ws}&q=viewer`);
  assert.ok(people.body.people.some((p) => p.id === s.viewerId));
  await admin.put(`/api/projects/${s.project}/visibility`, { hiddenUserIds: [s.viewerId] });
  const hidden = await viewer.get<{ tasks: unknown[] }>(`/api/search?workspaceId=${s.ws}&q=offer`);
  assert.equal(hidden.body.tasks.length, 0, "hidden project stays out of search");
  await admin.put(`/api/projects/${s.project}/visibility`, { hiddenUserIds: [] });
  assert.equal((await outsider.get(`/api/search?workspaceId=${s.ws}&q=offer`)).status, 404);
});

test("key results carry confidence and a deadline", async () => {
  const r = await admin.patch<{ keyResults: { id: string; confidence: number; dueDate: string | null }[] }>(`/api/key-results/${s.krLaptop}`, { confidence: 40, dueDate: "2031-12-31" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const kr = r.body.keyResults.find((k) => k.id === s.krLaptop)!;
  assert.equal(kr.confidence, 40);
  assert.equal(kr.dueDate, "2031-12-31");
  assert.equal((await admin.patch(`/api/key-results/${s.krLaptop}`, { confidence: 140 })).status, 400);
});
