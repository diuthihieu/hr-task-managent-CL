import { test } from "node:test";
import assert from "node:assert/strict";
import { ADMIN_EMAIL, BASE, prisma, admin, contributor, viewer, outsider, s, ask, lastModelRequest, action, type NotifList, type Rec } from "./context";

test("embedded AI actions: grounded in the target, personalized, and never outside the user's access", async () => {
  const prof = await admin.patch<{ aiTone: string }>("/api/account/profile", { jobTitle: "HR Director", aiInstructions: "Always end with a one-line takeaway.", aiTone: "concise", aiLength: "short" });
  assert.equal(prof.status, 200, JSON.stringify(prof.body));
  const sum = await action(admin, { action: "task_summarize", targetId: s.r6task });
  assert.equal(sum.status, 200, sum.text);
  const system = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.match(system, /Prepare offer letters/, "the task is in the context");
  assert.match(system, /Always end with a one-line takeaway/, "custom instructions");
  assert.match(system, /very concise/, "tone");
  assert.match(system, /PERMISSION SCOPE/, "scope guard on every prompt");
  assert.equal((await action(outsider, { action: "task_summarize", targetId: s.r6task })).status, 404);

  const br = await action(admin, { action: "task_breakdown", targetId: s.r6task });
  assert.equal(br.status, 200);
  assert.match(br.type, /application\/json/);
  assert.equal((JSON.parse(br.text) as { items: unknown[] }).items.length, 2);

  const brief = await action(contributor, { action: "home_brief", targetId: s.ws });
  assert.equal(brief.status, 200);
  assert.match((await lastModelRequest()).body.systemInstruction!.parts[0].text, /Prepare offer letters/, "my day includes my tasks");
  assert.equal((await action(outsider, { action: "home_brief", targetId: s.ws })).status, 404);
  assert.equal((await action(admin, { action: "dash_explain", targetId: s.project, targetKind: "project" })).status, 400, "dashboard actions need the chart data");
});

test("AI dashboard builder: only valid chart specs over real fields are kept", async () => {
  const rep = await admin.post<{ widgets: { id: string; type: string; dimensionFieldId?: string; layout: { x: number; y: number; w: number; h: number } }[] }>("/api/ai/build-widgets", { target: "report", projectId: s.project, prompt: "status overview and workload" });
  assert.equal(rep.status, 200, JSON.stringify(rep.body));
  assert.deepEqual(rep.body.widgets.map((w) => w.dimensionFieldId ?? w.type), ["kpi", "sys_status", "sys_assignees"], "the made-up field is dropped");
  assert.deepEqual(rep.body.widgets.map((w) => [w.layout.x, w.layout.y, w.layout.w]), [[0, 0, 3], [3, 0, 6], [0, 10, 12]], "width hints become a row-by-row layout");
  assert.equal((await admin.post("/api/ai/build-widgets", { target: "report", projectId: s.project, prompt: "x".repeat(6001) })).status, 400, "prompt limit");
  assert.equal((await viewer.post("/api/ai/build-widgets", { target: "report", projectId: s.project, prompt: "status overview" })).status, 403, "editors only");
  const d = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/dashboards`, { name: "AI built" });
  const built = await admin.post<{ widgets: unknown[] }>("/api/ai/build-widgets", { target: "dashboard", dashboardId: d.body.id, prompt: "status overview" });
  assert.equal(built.status, 201, JSON.stringify(built.body));
  assert.equal(await prisma.dashboardWidget.count({ where: { dashboardId: d.body.id } }), 3);
  // Append stacks below; replace swaps the whole set; new builds a separate dashboard.
  await admin.post("/api/ai/build-widgets", { target: "dashboard", dashboardId: d.body.id, prompt: "status overview", mode: "append" });
  const stacked = await prisma.dashboardWidget.findMany({ where: { dashboardId: d.body.id }, orderBy: { sortOrder: "asc" } });
  assert.equal(stacked.length, 6);
  assert.ok(stacked[3].y >= stacked[2].y + stacked[2].h, "appended widgets go below the existing ones");
  await admin.post("/api/ai/build-widgets", { target: "dashboard", dashboardId: d.body.id, prompt: "status overview", mode: "replace" });
  assert.equal(await prisma.dashboardWidget.count({ where: { dashboardId: d.body.id } }), 3, "replace keeps only the new layout");
  const fresh = await admin.post<{ dashboardId: string; widgets: unknown[] }>("/api/ai/build-widgets", { target: "dashboard", dashboardId: d.body.id, prompt: "a full HR dashboard", mode: "new" });
  assert.equal(fresh.status, 201, JSON.stringify(fresh.body));
  assert.notEqual(fresh.body.dashboardId, d.body.id);
  const dash = await prisma.dashboard.findUniqueOrThrow({ where: { id: fresh.body.dashboardId }, include: { _count: { select: { widgets: true } } } });
  assert.equal(dash.name, "HR ops (AI)");
  assert.equal(dash._count.widgets, 3);
  assert.equal(await prisma.dashboardWidget.count({ where: { dashboardId: d.body.id } }), 3, "the original dashboard is untouched");
  assert.equal((await viewer.post("/api/ai/build-widgets", { target: "dashboard", dashboardId: d.body.id, prompt: "a new dashboard", mode: "new" })).status, 403, "editors only");
});

test("AI PDF report: writes with chart markers; the report library is private to its creator", async () => {
  const data = "Tasks by status: Done 3, In progress 2";
  const gen = await admin.post<{ title: string; fileName: string; markdown: string; header: { workspace: string; author: string } }>("/api/ai/report", {
    targetKind: "project", targetId: s.project, prompt: "Monthly report with all charts", fileName: "CB/report:10", data, charts: [{ id: "w1", title: "Tasks by status" }],
  });
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  assert.match(gen.body.markdown, /\[\[chart:w1\]\]/, "the report places the chart");
  assert.equal(gen.body.fileName, "CB report 10", "unsafe file name characters are removed");
  assert.ok(gen.body.header.workspace && gen.body.header.author);
  assert.equal((await outsider.post("/api/ai/report", { targetKind: "project", targetId: s.project, prompt: "report please", data, charts: [] })).status, 404);
  assert.equal((await admin.post("/api/ai/report", { targetKind: "project", targetId: s.project, prompt: "x".repeat(4001), data, charts: [] })).status, 400);

  const saved = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/saved-reports`, {
    title: gen.body.title, fileName: gen.body.fileName, prompt: "Monthly report", content: gen.body.markdown, projectId: s.project,
    charts: [{ id: "w1", title: "Tasks by status", svg: "<svg viewBox='0 0 10 10'><rect width='10' height='10'/></svg>" }],
  });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const list = await admin.get<{ id: string; source: string | null }[]>(`/api/workspaces/${s.ws}/saved-reports?projectId=${s.project}`);
  assert.ok(list.body.some((r) => r.id === saved.body.id && r.source));
  const one = await admin.get<{ content: string; charts: { id: string }[] }>(`/api/saved-reports/${saved.body.id}`);
  assert.equal(one.status, 200);
  assert.equal(one.body.charts[0].id, "w1");
  // Private: a co-member can't list, open or delete it.
  assert.ok(!(await contributor.get<{ id: string }[]>(`/api/workspaces/${s.ws}/saved-reports`)).body.some((r) => r.id === saved.body.id));
  assert.equal((await contributor.get(`/api/saved-reports/${saved.body.id}`)).status, 404);
  assert.equal((await contributor.del(`/api/saved-reports/${saved.body.id}`)).status, 404);
  assert.equal((await outsider.get(`/api/workspaces/${s.ws}/saved-reports`)).status, 404);
  assert.equal((await admin.post(`/api/workspaces/${s.ws}/saved-reports`, { title: "x", fileName: "x", content: "x", charts: [{ id: "a", title: "a", svg: "x".repeat(400_001) }] })).status, 400, "chart size limit");
  const big = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, title: "c", svg: "x".repeat(399_000) }));
  assert.equal((await admin.post(`/api/workspaces/${s.ws}/saved-reports`, { title: "x", fileName: "x", content: "x", charts: big })).status, 400, "total chart size limit (request body cap)");
  assert.equal((await admin.del(`/api/saved-reports/${saved.body.id}`)).status, 200);

  // AI narrative card: reads the dashboard snapshot, with an optional focus; same access rules.
  const narr = await viewer.post<{ text: string; at: string }>("/api/ai/narrative", { targetKind: "project", targetId: s.project, data, instruction: "overdue risks" });
  assert.equal(narr.status, 200, JSON.stringify(narr.body));
  assert.ok(narr.body.text && narr.body.at);
  assert.match((await lastModelRequest()).body.systemInstruction!.parts[0].text, /overdue risks[\s\S]*Done 3/, "focus and data reach the model");
  assert.equal((await outsider.post("/api/ai/narrative", { targetKind: "project", targetId: s.project, data })).status, 404);
  assert.equal((await viewer.post("/api/ai/narrative", { targetKind: "project", targetId: s.project, data, instruction: "x".repeat(501) })).status, 400);
  assert.equal((await admin.get(`/api/saved-reports/${saved.body.id}`)).status, 404);
});

test("wiki comments: mentions, replies, delete rights, and the wiki AI reads the discussion", async () => {
  const page = await admin.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, { title: "Leave policy" });
  assert.equal(page.status, 201);
  const people = await viewer.get<{ id: string }[]>(`/api/wiki/${page.body.id}/mentionable`);
  assert.ok(people.body.some((p) => p.id === s.contributorId));
  const c = await viewer.post<{ id: string }>(`/api/wiki/${page.body.id}/comments`, { body: `**Question** for @[Casey Contributor](${s.contributorId}): does sick leave need a certificate after 2 days?` });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.ok(await prisma.notification.findFirst({ where: { userId: s.contributorId, type: "mention", link: { contains: page.body.id } } }), "mentioned person notified");
  const reply = await contributor.post<{ id: string }>(`/api/wiki/${page.body.id}/comments`, { body: "Yes, from day 3.", parentCommentId: c.body.id });
  assert.equal(reply.status, 201);
  assert.equal((await outsider.get(`/api/wiki/${page.body.id}/comments`)).status, 404);
  assert.equal((await contributor.del(`/api/wiki-comments/${c.body.id}`)).status, 403, "not the author, not a manager");
  const list = await viewer.get<unknown[]>(`/api/wiki/${page.body.id}/comments`);
  assert.equal(list.body.length, 2);
  const r = await ask(admin, { kind: "wiki", wikiId: s.wiki, message: "What does the discussion say about sick leave?" });
  assert.equal(r.status, 200, r.text);
  assert.match((await lastModelRequest()).body.systemInstruction!.parts[0].text, /certificate after 2 days/, "comments are part of the wiki's knowledge");
  assert.equal((await admin.del(`/api/wiki-comments/${c.body.id}`)).status, 204, "managers can delete");
});

test("profile & appearance: avatars are visible to co-members only; theme mode and tone are validated", async () => {
  const svg = await fetch(`${BASE}/api/users/${s.viewerId}/avatar`, { headers: { cookie: admin.cookieHeader() } });
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get("content-type") ?? "", /image\/svg\+xml/);
  assert.match(await svg.text(), /VV/, "initials when no picture was uploaded");
  assert.equal((await fetch(`${BASE}/api/users/${s.viewerId}/avatar`, { headers: { cookie: outsider.cookieHeader() } })).status, 404);
  assert.equal((await admin.patch("/api/account/preferences", { themeMode: "system", surfaceTone: "ocean" })).status, 200);
  assert.equal((await admin.patch("/api/account/preferences", { surfaceTone: "neon" })).status, 400);
  const sized = await admin.patch<{ fontSize: string; displaySize: string }>("/api/account/preferences", { fontSize: "lg", displaySize: "compact" });
  assert.equal(sized.status, 200);
  assert.deepEqual([sized.body.fontSize, sized.body.displaySize], ["lg", "compact"], "text and display size are saved");
  assert.equal((await admin.patch("/api/account/preferences", { fontSize: "huge" })).status, 400);
  assert.equal((await admin.patch("/api/account/preferences", { displaySize: "200%" })).status, 400);
  const home = await fetch(`${BASE}/workspaces`, { headers: { cookie: admin.cookieHeader() } });
  assert.match(await home.text(), /data-font-size="lg"[^>]*data-display="compact"/, "rendered on <html> by the server");
  await admin.patch("/api/account/preferences", { fontSize: "md", displaySize: "default" });
  const u = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  assert.equal(u.surfaceTone, "ocean");
  assert.equal((await admin.patch("/api/account/profile", { aiTone: "sarcastic" })).status, 400);
});

test("approvals: request, approve from the Action Center, and optionally complete the task", async () => {
  // An earlier test removes "Done"; completing on approval needs a done-category status.
  const statuses = (await admin.get<{ category: string }[]>(`/api/workspaces/${s.ws}/statuses`)).body;
  if (!statuses.some((x) => x.category === "done")) assert.equal((await admin.post(`/api/workspaces/${s.ws}/statuses`, { name: "Done", category: "done" })).status, 201);
  const people = await contributor.get<{ id: string }[]>(`/api/tasks/${s.r6task}/mentionable`);
  assert.ok(people.body.some((p) => p.id === s.viewerId));
  assert.equal((await viewer.post(`/api/tasks/${s.r6task}/approvals`, { approverId: s.contributorId })).status, 403, "viewers can't request approvals");
  assert.equal((await contributor.post(`/api/tasks/${s.r6task}/approvals`, { approverId: s.contributorId })).status, 400, "not yourself");
  assert.equal((await contributor.post(`/api/tasks/${s.r6task}/approvals`, { approverId: s.outsiderId })).status, 400, "approver must be a member");
  const req = await contributor.post<{ id: string; status: string }>(`/api/tasks/${s.r6task}/approvals`, { approverId: s.viewerId, note: "Please check the offer amounts", completeOnApprove: true });
  assert.equal(req.status, 201, JSON.stringify(req.body));
  assert.equal((await contributor.post(`/api/tasks/${s.r6task}/approvals`, { approverId: s.viewerId })).status, 409, "one pending request per approver");
  const inbox = await viewer.get<NotifList>("/api/notifications?view=todo");
  const n = inbox.body.items.find((x) => x.type === "approval_request" && x.taskId === s.r6task);
  assert.ok(n, "approver sees it in To do");
  assert.equal((await contributor.patch(`/api/approvals/${req.body.id}`, { decision: "approve" })).status, 403, "only the approver decides");
  const ok = await viewer.patch<{ status: string }>(`/api/approvals/${req.body.id}`, { decision: "approve", note: "Looks good" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.status, "approved");
  const task = await prisma.task.findUniqueOrThrow({ where: { id: s.r6task }, include: { status: true } });
  assert.equal(task.status.category, "done", "completed on approval, even though the approver is a viewer");
  assert.ok(!(await viewer.get<NotifList>("/api/notifications?view=todo")).body.items.some((x) => x.id === n!.id), "request leaves the approver's To do");
  const result = await prisma.notification.findFirst({ where: { userId: s.contributorId, type: "approval_result", taskId: s.r6task } });
  assert.equal((result!.data as { decision: string }).decision, "approved", "requester told the result");
  assert.equal((await viewer.patch(`/api/approvals/${req.body.id}`, { decision: "reject" })).status, 400, "already decided");
  const list = await contributor.get<{ status: string }[]>(`/api/tasks/${s.r6task}/approvals`);
  assert.equal(list.body[0].status, "approved");
});

test("AI suggestions: rule-based nudges that open the matching AI action, created once", async () => {
  const big = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Redesign the onboarding programme", sys_assignees: [s.contributorId], sys_estimate: 12 } });
  assert.equal(big.status, 201, JSON.stringify(big.body));
  await contributor.get("/api/notifications");
  await contributor.get("/api/notifications");
  const rows = await prisma.notification.findMany({ where: { userId: s.contributorId, type: "ai_suggestion", taskId: big.body.id } });
  assert.equal(rows.length, 1, "deduplicated");
  assert.equal((rows[0].data as { kind: string }).kind, "task_breakdown");
  assert.match(rows[0].link!, /\?ai=task_breakdown$/);
});

test("project icons: optional, chosen from the basic set", async () => {
  const none = await admin.post<{ id: string; icon: string | null }>(`/api/workspaces/${s.ws}/projects`, { name: "No icon project" });
  assert.equal(none.status, 201, JSON.stringify(none.body));
  assert.equal(none.body.icon, null, "no icon unless the user picks one");
  assert.equal((await admin.patch(`/api/projects/${none.body.id}`, { icon: "not-an-icon" })).status, 400);
  const set = await admin.patch<{ icon: string | null }>(`/api/projects/${none.body.id}`, { icon: "rocket" });
  assert.equal(set.body.icon, "rocket");
  assert.equal((await admin.patch<{ icon: string | null }>(`/api/projects/${none.body.id}`, { icon: null })).body.icon, null, "can be cleared");
});

test("dashboard drill-down: a clicked segment lists exactly the tasks it counts", async () => {
  const d = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/dashboards`, { name: "Drill-down" });
  const block = await admin.post<{ id: string }>(`/api/dashboards/${d.body.id}/blocks`, { type: "column", title: "By status", config: { dataSource: { projectId: s.project }, dimensionFieldId: "sys_status", aggregation: "count" } });
  assert.equal(block.status, 201, JSON.stringify(block.body));
  const data = await viewer.post<{ series: { key: string; label: string; value: number }[] }>(`/api/dashboard-blocks/${block.body.id}/data`, {});
  const point = data.body.series[0];
  assert.ok(point && point.value > 0, JSON.stringify(data.body));
  const res = await viewer.post<{ tasks: { id: string; title: string; status: { label: string } | null }[]; total: number }>(`/api/dashboard-blocks/${block.body.id}/records`, { segment: { key: point.key, label: point.label } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, point.value, "adds up to the bar");
  assert.ok(res.body.tasks.every((x) => x.status?.label === point.label));
  const kpi = await viewer.post<{ total: number }>(`/api/dashboard-blocks/${block.body.id}/records`, { segment: { key: "nope", label: "nope" } });
  assert.equal(kpi.body.total, 0);
  assert.equal((await outsider.post(`/api/dashboard-blocks/${block.body.id}/records`, { segment: { key: point.key, label: point.label } })).status, 404, "outsiders see nothing");
  assert.equal((await viewer.post(`/api/dashboard-blocks/${block.body.id}/records`, {})).status, 400, "segment required");
});
