import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "../client";
import { prisma, admin, contributor, viewer, outsider, s, ask, lastModelRequest, type Rec } from "./context";

test("My OKRs show only the viewer's own branch: objective -> their key result -> their tasks", async () => {
  type Obj = { id: string; keyResults: { id: string; title: string; tasks: { taskId: string }[] }[]; tasks: { taskId: string }[] };
  const o = await admin.post<Obj>(`/api/workspaces/${s.ws}/objectives`, {
    title: "Branch visibility",
    projectId: s.project,
    keyResults: [{ title: "KR owned by contributor", ownerId: s.contributorId }, { title: "KR with tasks" }],
  });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const [krC, krT] = o.body.keyResults;
  const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@integration.test" } })).id;
  const mk = async (title: string, assignee: string, target: string) => {
    const r = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: title, sys_assignees: [assignee], sys_objective: target } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.id;
  };
  const vTask = await mk("Viewer's branch task", s.viewerId, `kr:${krT.id}`);
  const otherTask = await mk("Someone else's task", s.contributorId, `kr:${krT.id}`);
  const cOnKrC = await mk("Admin task under contributor KR", adminId, `kr:${krC.id}`);
  const find = async (c: Client) => (await c.get<Obj[]>(`/api/workspaces/${s.ws}/objectives?mine=1`)).body.find((x) => x.id === o.body.id);

  const v = await find(viewer);
  assert.ok(v, "assignee sees the objective of their task");
  assert.deepEqual(v!.keyResults.map((k) => k.id), [krT.id], "only the key result holding their task");
  assert.deepEqual(v!.keyResults[0].tasks.map((x) => x.taskId), [vTask], "only their own task");

  const c = await find(contributor);
  assert.deepEqual(c!.keyResults.map((k) => k.id).sort(), [krC.id, krT.id].sort(), "own KR + KR holding their task");
  assert.deepEqual(c!.keyResults.find((k) => k.id === krC.id)!.tasks.map((x) => x.taskId), [cOnKrC], "a KR owner sees every task of that KR");
  assert.deepEqual(c!.keyResults.find((k) => k.id === krT.id)!.tasks.map((x) => x.taskId), [otherTask]);

  const detail = await viewer.get<Obj>(`/api/objectives/${o.body.id}?mine=1`);
  assert.deepEqual(detail.body.keyResults.map((k) => k.id), [krT.id], "detail opened from My OKRs is pruned too");
  assert.equal((await viewer.get<Obj>(`/api/objectives/${o.body.id}`)).body.keyResults.length, 2, "Team view unchanged");
});

test("wiki pages that quote a hidden project are hidden too - in the UI, search and AI answers", async () => {
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId] });
  const wiki = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/wikis`, { name: "Team reports", access: "workspace" });
  // What happened in production: a workspace-wide report (built by someone who sees every project) saved as a wiki page.
  const report = await admin.post<{ id: string }>(`/api/wikis/${wiki.body.id}/pages`, {
    title: "Weekly report - whole workspace",
    content: "<h2>Other project</h2><table><tr><td>Call the insurer</td><td>In Progress</td></tr></table><p>Budget review: pending</p>",
  });
  assert.equal(report.status, 201, JSON.stringify(report.body));
  const clean = await admin.post<{ id: string }>(`/api/wikis/${wiki.body.id}/pages`, { title: "Leave policy", content: "<p>Twelve days a year.</p>" });

  assert.equal((await viewer.get(`/api/wiki/${report.body.id}`)).status, 404, "hidden from the viewer");
  assert.equal((await viewer.get(`/api/wiki/${clean.body.id}`)).status, 200);
  const tree = (await viewer.get<{ id: string }[]>(`/api/wikis/${wiki.body.id}/pages`)).body.map((p) => p.id);
  assert.ok(!tree.includes(report.body.id) && tree.includes(clean.body.id), "left out of the page tree");
  assert.equal((await viewer.get<{ pages: unknown[] }>(`/api/search?workspaceId=${s.ws}&q=Weekly%20report`)).body.pages.length, 0, "and out of search");
  assert.equal((await viewer.get(`/api/wiki/${report.body.id}/comments`)).status, 404);
  const own = await admin.get<{ restrictedTo: { name: string }[] }>(`/api/wiki/${report.body.id}`);
  assert.deepEqual(own.body.restrictedTo.map((p) => p.name), ["Other project"], "people who can see it get a notice");

  await prisma.aiMessage.deleteMany({ where: { conversation: { userId: s.viewerId } } }); // reset the daily quota used up earlier
  assert.equal((await ask(viewer, { kind: "assistant", workspaceId: s.ws, message: "report on Other project" })).status, 200);
  let system = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.match(system, /Leave policy/, "other wiki pages still reach the AI");
  assert.doesNotMatch(system, /Call the insurer|Weekly report - whole workspace/, "the quoting page doesn't");
  assert.equal((await ask(viewer, { kind: "wiki", wikiId: wiki.body.id, message: "what's in the weekly report?" })).status, 200);
  system = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.doesNotMatch(system, /Call the insurer/, "nor through the wiki's own assistant");

  // A comment quoting the hidden project restricts a page that was fine before; mentioning the viewer doesn't notify them.
  const c = await admin.post(`/api/wiki/${clean.body.id}/comments`, { body: `@[Vic](${s.viewerId}) see Call the insurer` });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  assert.equal((await viewer.get(`/api/wiki/${clean.body.id}`)).status, 404);
  assert.equal(await prisma.notification.count({ where: { userId: s.viewerId, type: "mention", data: { path: ["where"], equals: "wiki" }, title: "Leave policy" } }), 0);

  // Unhiding the project gives the pages back.
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] });
  assert.equal((await viewer.get(`/api/wiki/${report.body.id}`)).status, 200);
  assert.deepEqual((await admin.get<{ restrictedTo: unknown[] }>(`/api/wiki/${report.body.id}`)).body.restrictedTo, [], "no notice when nobody is hidden");
});

test("knowledge graph: built from existing relations, filtered by access, with a local view around one node", async () => {
  type G = { nodes: { id: string; type: string; depth?: number; href?: string; degree: number }[]; links: { source: string; target: string; kind: string }[]; focus?: string };
  const slug = (await admin.get<{ slug: string }>(`/api/workspaces/${s.ws}`)).body.slug;
  const task = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Graph: collect IDs", sys_category: s.category, sys_assignees: [s.contributorId] } });
  const hiddenTask = await admin.post<Rec>(`/api/projects/${s.otherProject}/tasks`, { data: { sys_title: "Graph: secret task" } });
  // A wiki page linking to the task and to the hidden task through ordinary links in its content.
  const page = await admin.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, {
    title: "Graph: onboarding guide",
    content: `<p>See <a href="/w/${slug}/p/${s.project}/t/${task.body.id}">the task</a> and <a href="/w/${slug}/p/${s.otherProject}/t/${hiddenTask.body.id}">that one</a>.</p>`,
  });
  assert.equal(page.status, 201, JSON.stringify(page.body));
  const secretWiki = await contributor.post<{ id: string }>(`/api/workspaces/${s.ws}/wikis`, { name: "Graph secrets", access: "restricted" });
  const secretPage = await contributor.post<{ id: string }>(`/api/wikis/${secretWiki.body.id}/pages`, { title: "Graph: salary bands" });
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId] });

  const has = (g: G, a: string, b: string, kind: string) => g.links.some((l) => l.kind === kind && ((l.source === a && l.target === b) || (l.source === b && l.target === a)));
  const full = (await admin.get<G>(`/api/workspaces/${s.ws}/graph`)).body;
  const [T, H, W] = [`task:${task.body.id}`, `task:${hiddenTask.body.id}`, `wiki:${page.body.id}`];
  assert.ok(has(full, W, T, "link") && has(full, W, H, "link"), "links written in content become edges");
  assert.ok(has(full, T, `project:${s.project}`, "project") && has(full, T, `tag:${s.category}`, "tag") && has(full, T, `person:${s.contributorId}`, "assignee"));
  assert.ok(has(full, `kr:${s.krLaptop}`, full.nodes.find((n) => n.type === "objective" && has(full, `kr:${s.krLaptop}`, n.id, "okr"))!.id, "okr"), "OKR tree");
  assert.equal(full.nodes.find((n) => n.id === T)!.href, `/w/${slug}/p/${s.project}/t/${task.body.id}`);
  assert.ok(full.nodes.every((n) => n.degree === full.links.filter((l) => l.source === n.id || l.target === n.id).length), "size = number of links");
  assert.ok(full.links.every((l) => full.nodes.some((n) => n.id === l.source) && full.nodes.some((n) => n.id === l.target)));
  assert.ok(full.nodes.some((n) => n.id === `wiki:${secretPage.body.id}`), "workspace admins see every wiki");

  const v = (await viewer.get<G>(`/api/workspaces/${s.ws}/graph`)).body;
  const ids = new Set(v.nodes.map((n) => n.id));
  assert.ok(ids.has(W) && ids.has(T));
  assert.ok(!ids.has(H) && !ids.has(`project:${s.otherProject}`) && !ids.has(`tag:${s.otherCategory}`), "hidden project, its tasks and tags are absent");
  assert.ok(!has(v, W, H, "link"), "a link never reveals a hidden item");
  assert.ok(!ids.has(`wiki:${secretPage.body.id}`), "restricted wiki pages are absent");

  const local = await viewer.get<G>(`/api/workspaces/${s.ws}/graph?focus=${W}&depth=1`);
  assert.equal(local.status, 200);
  assert.equal(local.body.focus, W);
  assert.equal(local.body.nodes.find((n) => n.id === W)!.depth, 0);
  assert.ok(local.body.nodes.some((n) => n.id === T && n.depth === 1));
  assert.ok(local.body.nodes.every((n) => n.depth! <= 1) && !local.body.nodes.some((n) => n.id === `tag:${s.category}`), "depth 1 = direct neighbours only");
  const two = (await viewer.get<G>(`/api/workspaces/${s.ws}/graph?focus=${W}&depth=2`)).body;
  assert.ok(two.nodes.some((n) => n.id === `tag:${s.category}` && n.depth === 2), "the task's tag is two hops away");

  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/graph?focus=wiki:nope`)).status, 400);
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/graph?depth=5`)).status, 400);
  assert.equal((await outsider.get(`/api/workspaces/${s.ws}/graph`)).status, 404);
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] });
});

test("second brain: [[links]], backlinks, block links, tags, related, versions and knowledge metadata", async () => {
  type Conn = { backlinks: { type: string; id: string; context: string; blockId?: string }[]; unlinked: { id: string }[]; outgoing: { target: string; broken: boolean; blockMissing?: boolean }[]; related: { id: string; reasons: string[] }[] };
  const slug = (await admin.get<{ slug: string }>(`/api/workspaces/${s.ws}`)).body.slug;
  const W = s.wiki;
  const a = await admin.post<{ id: string }>(`/api/wikis/${W}/pages`, { title: "Probation policy", content: `<p>Intro.</p><p data-block-id="blk00001">Probation lasts 60 days for new hires.</p><p data-block-id="BAD id">x</p>` });
  assert.equal(a.status, 201);
  const gone = await admin.post<{ id: string }>(`/api/wikis/${W}/pages`, { title: "Temp page" });
  await admin.del(`/api/wiki/${gone.body.id}`);
  const b = await admin.post<{ id: string }>(`/api/wikis/${W}/pages`, {
    title: "Onboarding checklist",
    content: `<p>See <a href="/w/${slug}/wiki/${W}/${a.body.id}#b-blk00001" target="_blank">the probation rule</a> and <a href="/w/${slug}/wiki/${W}/${gone.body.id}">old page</a> and <a href="/w/${slug}/wiki/${W}/${a.body.id}#b-zzzzzz99">a removed block</a>.</p>`,
  });
  const c = await admin.post<{ id: string }>(`/api/wikis/${W}/pages`, { title: "HR FAQ", content: "<p>Read the Probation policy before day one.</p>" });
  s.brainPageA = a.body.id;
  s.brainPageB = b.body.id;

  // Content stays the source of truth: block ids survive sanitizing (invalid ones don't); internal links open in-app.
  const pa = await admin.get<{ content: string; meta: { tags: string[]; version: number; status: string } }>(`/api/wiki/${a.body.id}`);
  assert.match(pa.body.content, /data-block-id="blk00001"/);
  assert.doesNotMatch(pa.body.content, /BAD id/);
  const pb = await admin.get<{ content: string }>(`/api/wiki/${b.body.id}`);
  assert.doesNotMatch(pb.body.content, /target="_blank"[^>]*>the probation/, "internal links carry no target=_blank");
  assert.equal(pa.body.meta.version, 1);
  assert.equal(pa.body.meta.status, "current");

  const conn = (await admin.get<Conn>(`/api/wiki/${a.body.id}/connections`)).body;
  const back = conn.backlinks.find((x) => x.id === b.body.id)!;
  assert.ok(back, "backlink from the page that links here");
  assert.equal(back.blockId, "blk00001", "block-level backlink");
  assert.match(back.context, /the probation rule/, "with the linking sentence");
  assert.ok(conn.unlinked.some((x) => x.id === c.body.id), "unlinked mention of the title");
  const outB = (await admin.get<Conn>(`/api/wiki/${b.body.id}/connections`)).body.outgoing;
  assert.ok(outB.some((o) => o.target === `wiki:${a.body.id}` && !o.broken && !o.blockMissing));
  assert.ok(outB.some((o) => o.target === `wiki:${gone.body.id}` && o.broken), "link to a deleted page is broken");
  assert.ok(outB.some((o) => o.target === `wiki:${a.body.id}` && o.blockMissing), "link to a missing block is flagged");

  // Metadata: tags normalized, validity checked, "still correct" stamps last checked.
  const meta = await admin.patch<{ meta: { tags: string[]; lastCheckedAt: string | null; kind: string } }>(`/api/wiki/${a.body.id}`, { tags: ["#Onboarding", "HR Policy", "onboarding"], kind: "process", markChecked: true, sourceLabel: "Labour Code art. 25", confidence: "high" });
  assert.deepEqual(meta.body.meta.tags, ["onboarding", "hr-policy"]);
  assert.ok(meta.body.meta.lastCheckedAt);
  assert.equal(meta.body.meta.kind, "process");
  assert.equal((await admin.patch(`/api/wiki/${a.body.id}`, { validFrom: "2026-05-01", validTo: "2026-01-01" })).status, 400);
  assert.equal((await viewer.patch(`/api/wiki/${a.body.id}`, { tags: ["x"] })).status, 403, "readers can't change metadata");

  // Related: shares a tag.
  const d = await admin.post<{ id: string }>(`/api/wikis/${W}/pages`, { title: "Buddy program" });
  await admin.patch(`/api/wiki/${d.body.id}`, { tags: ["onboarding"] });
  const rel = (await admin.get<Conn>(`/api/wiki/${a.body.id}/connections`)).body.related;
  assert.ok(rel.find((r) => r.id === d.body.id)?.reasons.includes("#onboarding"));

  // Link picker covers every entity type the viewer can see.
  const picker = await viewer.get<{ items: { type: string; href: string }[] }>(`/api/workspaces/${s.ws}/brain/link-targets?q=Probation`);
  assert.ok(picker.body.items.some((i) => i.type === "wiki" && i.href.endsWith(a.body.id)));

  // A page quoting a project hidden from the viewer never shows up as their backlink.
  const secret = await admin.post<{ id: string }>(`/api/wikis/${W}/pages`, { title: "Other project notes", content: `<p>Other project: see <a href="/w/${slug}/wiki/${W}/${a.body.id}">policy</a></p>` });
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId] });
  const vb = (await viewer.get<Conn>(`/api/wiki/${a.body.id}/connections`)).body.backlinks;
  assert.ok(vb.some((x) => x.id === b.body.id) && !vb.some((x) => x.id === secret.body.id));
  // Nor as an unlinked mention, in "For you" activity, or a decision about that project in their journal.
  const mention = await admin.post<{ id: string }>(`/api/wikis/${W}/pages`, { title: "Other project plan", content: "<p>Other project: cut 30% of staff. Read the probation policy first.</p>" });
  assert.equal(mention.status, 201);
  const today = new Date().toISOString().slice(0, 10);
  const hiddenDecision = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/decisions`, { title: "Other project layoffs approved", projectId: s.otherProject, people: [s.viewerId], decidedAt: today });
  assert.equal(hiddenDecision.status, 201, JSON.stringify(hiddenDecision.body));
  type ForYou = { activity: { id: string }[] };
  type Journal = { decisions: { id: string }[] };
  const seen = async () => ({
    unlinked: (await viewer.get<Conn>(`/api/wiki/${a.body.id}/connections`)).body.unlinked.some((x) => x.id === mention.body.id),
    activity: (await viewer.get<ForYou>(`/api/workspaces/${s.ws}/brain/for-you`)).body.activity.some((x) => x.id === mention.body.id),
    decision: (await viewer.get<Journal>(`/api/workspaces/${s.ws}/journal?date=${today}`)).body.decisions.some((x) => x.id === hiddenDecision.body.id),
  });
  assert.deepEqual(await seen(), { unlinked: false, activity: false, decision: false }, "nothing about the hidden project leaks through the Second Brain");
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] });
  assert.deepEqual(await seen(), { unlinked: true, activity: true, decision: true }, "and it all shows again once the project is visible");
  await admin.del(`/api/wiki/${mention.body.id}`);
  await admin.del(`/api/decisions/${hiddenDecision.body.id}`);

  // Temporal knowledge: a new version supersedes the old one, which stays as history.
  const v2 = await admin.post<{ id: string }>(`/api/wiki/${c.body.id}/new-version`, {});
  assert.equal(v2.status, 201);
  const old = await admin.get<{ meta: { status: string; supersededBy: { id: string } | null; validTo: string | null } }>(`/api/wiki/${c.body.id}`);
  assert.equal(old.body.meta.status, "superseded");
  assert.equal(old.body.meta.supersededBy?.id, v2.body.id);
  const fresh = await admin.get<{ meta: { version: number; supersedes: { id: string } | null } }>(`/api/wiki/${v2.body.id}`);
  assert.equal(fresh.body.meta.version, 2);
  assert.equal(fresh.body.meta.supersedes?.id, c.body.id);
  assert.equal((await admin.post(`/api/wiki/${c.body.id}/new-version`, {})).status, 400, "only one newer version");
  s.brainOldPage = c.body.id;
});

test("second brain: highlight -> task (recurring, OKR), reminder, decisions, graph and search", async () => {
  const A = s.brainPageA;
  // Viewers can't create tasks in the project; contributors can.
  assert.equal((await viewer.post(`/api/wiki/${A}/to-task`, { projectId: s.project, title: "x" })).status, 403);
  const tk = await contributor.post<{ id: string; href: string }>(`/api/wiki/${A}/to-task`, {
    projectId: s.project,
    title: "Run probation review",
    text: "Probation lasts 60 days for new hires.",
    blockId: "blk00001",
    dueDate: "2026-11-02",
    recurrence: { freq: "weekly", interval: 1 },
    okr: `kr:${s.krLaptop}`,
  });
  assert.equal(tk.status, 201, JSON.stringify(tk.body));
  const task = await prisma.task.findUniqueOrThrow({ where: { id: tk.body.id }, include: { assignees: true } });
  assert.equal(task.recurrenceFreq, "weekly");
  assert.equal(task.keyResultId, s.krLaptop);
  assert.deepEqual(task.assignees.map((x) => x.userId), [s.contributorId]);
  assert.match(task.content ?? "", new RegExp(`${A}#b-blk00001`), "task quotes and links back to the block");
  const conn = (await admin.get<{ backlinks: { type: string; id: string; blockId?: string }[] }>(`/api/wiki/${A}/connections`)).body;
  assert.ok(conn.backlinks.some((b) => b.type === "task" && b.id === tk.body.id && b.blockId === "blk00001"), "the task appears in the page's backlinks");

  // Completing a recurring task creates the next occurrence once (a week later).
  let done = await prisma.status.findFirst({ where: { workspaceId: s.ws, category: "done" } });
  done ??= await prisma.status.create({ data: { workspaceId: s.ws, name: "Done", category: "done", color: "#22c55e", sortOrder: 99 } });
  assert.equal((await contributor.patch(`/api/tasks/${tk.body.id}`, { data: { sys_status: done.id } })).status, 200);
  const next = await prisma.task.findFirst({ where: { recurrenceParentId: tk.body.id }, include: { assignees: true } });
  assert.ok(next, "next occurrence created");
  assert.equal(next!.dueDate!.toISOString().slice(0, 10), "2026-11-09");
  assert.equal(next!.keyResultId, s.krLaptop);
  assert.deepEqual(next!.assignees.map((x) => x.userId), [s.contributorId]);
  const todo = await prisma.status.findFirst({ where: { workspaceId: s.ws, category: "todo" } });
  await contributor.patch(`/api/tasks/${tk.body.id}`, { data: { sys_status: todo!.id } });
  await contributor.patch(`/api/tasks/${tk.body.id}`, { data: { sys_status: done.id } });
  assert.equal(await prisma.task.count({ where: { recurrenceParentId: tk.body.id } }), 1, "re-completing doesn't duplicate");
  s.brainTask = tk.body.id;

  // Reminder: hidden until its time, then it is an ordinary notification linking to the block.
  const at = new Date(Date.now() + 3600_000).toISOString();
  const rem = await viewer.post<{ id: string }>(`/api/wiki/${A}/reminder`, { at, text: "Probation lasts 60 days", blockId: "blk00001" });
  assert.equal(rem.status, 201);
  const n = await prisma.notification.findUniqueOrThrow({ where: { id: rem.body.id } });
  assert.equal(n.type, "reminder");
  assert.ok(n.snoozedUntil && n.link?.endsWith(`${A}#b-blk00001`));
  assert.equal((await viewer.post(`/api/wiki/${A}/reminder`, { at: "2020-01-01T00:00:00Z" })).status, 400);

  // Decision memory, with a supersede chain and people involved.
  const d1 = await contributor.post<{ id: string; status: string }>(`/api/workspaces/${s.ws}/decisions`, {
    title: "Probation is 60 days",
    reason: "Aligned with the labour code",
    alternatives: [{ option: "90 days", whyNot: "Too long for junior roles" }],
    evidence: "Legal review",
    projectId: s.project,
    wikiPageId: A,
    sourceBlockId: "blk00001",
    people: [s.contributorId, s.viewerId],
    decidedAt: "2026-09-01",
  });
  assert.equal(d1.status, 201, JSON.stringify(d1.body));
  const d2 = await contributor.post<{ id: string; supersedes: { id: string } | null }>(`/api/workspaces/${s.ws}/decisions`, { title: "Probation is 45 days for interns", supersedesId: d1.body.id, decidedAt: "2026-09-20", projectId: s.project });
  assert.equal(d2.body.supersedes?.id, d1.body.id);
  const d1After = await admin.get<{ status: string; validTo: string; supersededBy: { id: string } | null; alternatives: unknown[]; people: unknown[] }>(`/api/decisions/${d1.body.id}`);
  assert.equal(d1After.body.status, "superseded");
  assert.equal(d1After.body.validTo, "2026-09-19");
  assert.equal(d1After.body.alternatives.length, 1);
  assert.equal(d1After.body.people.length, 2);
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/decisions`, { title: "x" })).status, 403, "viewers can't record decisions");
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/decisions`, { title: "x", people: [s.outsiderId] })).status, 400);
  assert.equal((await outsider.get(`/api/decisions/${d1.body.id}`)).status, 404);
  const other = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/decisions`, { title: "Other project budget", projectId: s.otherProject });
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId] });
  assert.equal((await viewer.get(`/api/decisions/${other.body.id}`)).status, 404, "decisions of hidden projects are hidden");
  assert.ok(!(await viewer.get<{ id: string }[]>(`/api/workspaces/${s.ws}/decisions`)).body.some((x) => x.id === other.body.id));
  // Nor can they be superseded by someone they're hidden from, or show up as a visible decision's link.
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId, s.contributorId] });
  const before = (await prisma.decision.findUniqueOrThrow({ where: { id: other.body.id } })).status;
  const sneaky = await contributor.post<{ id?: string }>(`/api/workspaces/${s.ws}/decisions`, { title: "x", supersedesId: other.body.id });
  assert.equal(sneaky.status, 404, "a hidden decision can't be superseded");
  assert.equal((await prisma.decision.findUniqueOrThrow({ where: { id: other.body.id } })).status, before, "and keeps its status");
  assert.equal(await prisma.decision.count({ where: { title: "x", workspaceId: s.ws, deletedAt: null } }), 0, "nothing half-created");
  const plan = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/decisions`, { title: "Other project plan", projectId: s.otherProject });
  const followUp = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/decisions`, { title: "Visible follow-up", projectId: s.project, supersedesId: plan.body.id });
  assert.equal(followUp.status, 201, JSON.stringify(followUp.body));
  type Linked = { id: string; supersedes: { title: string } | null; supersededBy: { title: string } | null };
  assert.equal((await viewer.get<Linked>(`/api/decisions/${followUp.body.id}`)).body.supersedes, null, "the hidden predecessor's title isn't shown");
  assert.equal((await viewer.get<Linked[]>(`/api/workspaces/${s.ws}/decisions`)).body.find((x) => x.id === followUp.body.id)?.supersedes, null, "not in the list either");
  assert.equal((await admin.get<Linked>(`/api/decisions/${followUp.body.id}`)).body.supersedes?.title, "Other project plan", "people who see both still get the link");
  await admin.del(`/api/decisions/${followUp.body.id}`);
  await admin.del(`/api/decisions/${plan.body.id}`);
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] });
  const pageDecisions = (await admin.get<{ backlinks: { type: string; id: string }[] }>(`/api/wiki/${A}/connections`)).body.backlinks.filter((x) => x.type === "decision");
  assert.ok(pageDecisions.some((x) => x.id === d1.body.id), "decisions recorded from a page are its backlinks");
  s.brainDecision = d1.body.id;

  // Graph: decisions and wiki tags are nodes; tags join categories of the same name.
  const g = (await admin.get<{ nodes: { id: string }[]; links: { source: string; target: string; kind: string }[] }>(`/api/workspaces/${s.ws}/graph`)).body;
  assert.ok(g.nodes.some((x) => x.id === `decision:${d1.body.id}`) && g.nodes.some((x) => x.id === "tag:#onboarding"));
  assert.ok(g.links.some((l) => l.kind === "supersedes" && [l.source, l.target].includes(`decision:${d2.body.id}`)));
  assert.ok(g.links.some((l) => [l.source, l.target].includes("tag:#onboarding") && [l.source, l.target].includes(`tag:${s.category}`)), "#onboarding meets the Onboarding category");
  assert.ok(g.links.some((l) => l.kind === "involved" && [l.source, l.target].includes(`person:${s.viewerId}`)));

  // Search: decisions and #tags.
  const found = await admin.get<{ decisions: { id: string }[]; pages: { id: string }[] }>(`/api/search?workspaceId=${s.ws}&q=${encodeURIComponent("Probation is")}`);
  assert.ok(found.body.decisions.some((x) => x.id === d1.body.id));
  const byTag = await admin.get<{ pages: { id: string }[] }>(`/api/search?workspaceId=${s.ws}&q=${encodeURIComponent("#hr-policy")}`);
  assert.deepEqual(byTag.body.pages.map((p) => p.id), [A]);
});

test("second brain: journal, for-you resurfacing, spaced review, weekly review and knowledge health", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const j = await contributor.get<{ completed: { id: string }[]; created: { id: string }[]; decisions: { id: string }[]; notes: string | null }>(`/api/workspaces/${s.ws}/journal?date=${today}&tz=0`);
  assert.ok(j.body.completed.some((x) => x.id === s.brainTask), "work completed today");
  assert.ok(j.body.created.some((x) => x.id === s.brainTask));
  assert.equal((await contributor.put(`/api/workspaces/${s.ws}/journal`, { date: today, notes: "<p>Learned: <script>x</script>check the probation rule</p>" })).status, 200);
  const j2 = await contributor.get<{ notes: string }>(`/api/workspaces/${s.ws}/journal?date=${today}`);
  assert.doesNotMatch(j2.body.notes, /script/);
  assert.equal((await viewer.get<{ notes: string | null }>(`/api/workspaces/${s.ws}/journal?date=${today}`)).body.notes, null, "journals are private");
  await prisma.aiMessage.deleteMany({ where: { conversation: { userId: s.contributorId } } });
  const sum = await contributor.post<{ aiSummary: string }>(`/api/workspaces/${s.ws}/journal/summary`, { date: today, tz: 0 });
  assert.equal(sum.status, 200, JSON.stringify(sum.body));
  const system = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.match(system, /Run probation review/, "the day's work reaches the summary");

  // For you: the page linked from my open recurring task comes back to me.
  const fy = await contributor.get<{ relatedToWork: { id: string; because: string[] }[]; dueForReview: { id: string }[] }>(`/api/workspaces/${s.ws}/brain/for-you`);
  assert.ok(fy.body.relatedToWork.some((x) => x.id === s.brainPageA && x.because.includes("Run probation review")), JSON.stringify(fy.body.relatedToWork));
  // Spaced review: add -> not due yet; when due it is listed; "done" moves to the next interval.
  const r = await contributor.post<{ stage: number; nextReviewAt: string }>(`/api/wiki/${s.brainPageA}/review`, { action: "add" });
  assert.equal(r.body.stage, 0);
  await prisma.knowledgeReview.updateMany({ where: { userId: s.contributorId, pageId: s.brainPageA }, data: { nextReviewAt: new Date(Date.now() - 1000) } });
  assert.ok((await contributor.get<{ dueForReview: { id: string }[] }>(`/api/workspaces/${s.ws}/brain/for-you`)).body.dueForReview.some((x) => x.id === s.brainPageA));
  const r2 = await contributor.post<{ stage: number; nextReviewAt: string }>(`/api/wiki/${s.brainPageA}/review`, { action: "done" });
  assert.equal(r2.body.stage, 1);
  assert.ok(new Date(r2.body.nextReviewAt).getTime() > Date.now() + 2.9 * 86400000, "next review in 3 days");

  const wk = await contributor.get<{ newKnowledge: { id: string }[]; decisions: { id: string }[]; completed: { id: string }[] }>(`/api/workspaces/${s.ws}/brain/weekly`);
  assert.ok(wk.body.newKnowledge.some((x) => x.id === s.brainPageA) && wk.body.completed.some((x) => x.id === s.brainTask));
  // Second Brain Home can review a month or a year too.
  const day = new Date().toISOString().slice(0, 10);
  const mo = await contributor.get<{ period: string; weekStart: string; end: string; newKnowledge: { id: string }[] }>(`/api/workspaces/${s.ws}/brain/weekly?period=month&week=${day}`);
  assert.equal(mo.status, 200, JSON.stringify(mo.body));
  assert.equal(mo.body.period, "month");
  assert.equal(mo.body.weekStart, `${day.slice(0, 7)}-01`);
  assert.ok(mo.body.newKnowledge.some((x) => x.id === s.brainPageA), "this month includes this week's pages");
  const yr = await contributor.get<{ weekStart: string; end: string }>(`/api/workspaces/${s.ws}/brain/weekly?period=year`);
  assert.equal(yr.body.weekStart, `${day.slice(0, 4)}-01-01`);
  assert.equal(yr.body.end, `${Number(day.slice(0, 4)) + 1}-01-01`);
  assert.equal((await contributor.get(`/api/workspaces/${s.ws}/brain/weekly?period=decade`)).status, 400);

  // Knowledge health: broken links, expired validity, duplicates, missing source - suggestions only.
  await admin.patch(`/api/wiki/${s.brainPageB}`, { validFrom: "2025-01-01", validTo: "2025-12-31" });
  const dup = await admin.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, { title: "Onboarding  checklist" });
  const ai = await admin.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, { title: "Imported policy" });
  await admin.patch(`/api/wiki/${ai.body.id}`, { sourceType: "imported" });
  const before = await prisma.wikiPage.findUniqueOrThrow({ where: { id: s.brainPageB }, select: { updatedAt: true, status: true } });
  const h = await admin.get<{ issues: { type: string; pageId: string; suggestion: string }[]; counts: Record<string, number> }>(`/api/workspaces/${s.ws}/brain/health`);
  const has = (type: string, pageId: string) => h.body.issues.some((i) => i.type === type && i.pageId === pageId);
  assert.ok(has("broken_link", s.brainPageB), "broken link");
  assert.ok(has("outdated", s.brainPageB), "expired validity");
  assert.ok(has("duplicate", s.brainPageB) || has("duplicate", dup.body.id), "duplicate titles");
  assert.ok(has("missing_source", ai.body.id), "imported without a source");
  const after = await prisma.wikiPage.findUniqueOrThrow({ where: { id: s.brainPageB }, select: { updatedAt: true, status: true } });
  assert.deepEqual(after, before, "health checks never change knowledge");
  const conflicts = await admin.post<{ conflicts: unknown[]; checkedPairs: number }>(`/api/workspaces/${s.ws}/brain/health/conflicts`, {});
  assert.equal(conflicts.status, 200);
  assert.ok(conflicts.body.checkedPairs >= 1);

  // Daily Intelligence: prioritized attention items + a chronological timeline of the day.
  const di = await contributor.get<{ hero: unknown; needsAttention: { kind: string }[]; insights: { kind: string }[]; activity: unknown[]; myTasks: unknown[] }>(`/api/workspaces/${s.ws}/brain/for-you`);
  assert.ok(Array.isArray(di.body.needsAttention) && Array.isArray(di.body.insights) && Array.isArray(di.body.activity));
  const tl = await contributor.get<{ timeline: { type: string; title: string; at: string }[] }>(`/api/workspaces/${s.ws}/journal?date=${today}&tz=0`);
  assert.ok(tl.body.timeline.some((e) => e.type === "completed" && e.title === "Run probation review"), JSON.stringify(tl.body.timeline));
  assert.deepEqual([...tl.body.timeline].map((e) => e.at), [...tl.body.timeline].map((e) => e.at).sort(), "the timeline is chronological");
  const insights = await contributor.post<{ insights: { title: string; action: string }[] }>(`/api/workspaces/${s.ws}/brain/insights`, {});
  assert.equal(insights.status, 200, JSON.stringify(insights.body));
  assert.ok(insights.body.insights.length >= 1);

  // Structured decisions: owner (must be a member) and review date; due reviews resurface.
  const dec = await contributor.post<{ id: string; owner: { id: string } | null; reviewDue: boolean }>(`/api/workspaces/${s.ws}/decisions`, { title: "Review the intern stipend", reviewDate: "2026-01-01", ownerId: s.contributorId });
  assert.equal(dec.status, 201, JSON.stringify(dec.body));
  assert.equal(dec.body.owner?.id, s.contributorId);
  assert.equal(dec.body.reviewDue, true);
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/decisions`, { title: "x", ownerId: s.outsiderId })).status, 400, "owners are members");
  const due = await contributor.get<{ id: string }[]>(`/api/workspaces/${s.ws}/decisions?review=due`);
  assert.ok(due.body.some((d) => d.id === dec.body.id));
  const defOwner = await contributor.post<{ owner: { id: string } | null }>(`/api/workspaces/${s.ws}/decisions`, { title: "Default owner is the author" });
  assert.equal(defOwner.body.owner?.id, s.contributorId);
  const fy2 = await contributor.get<{ needsAttention: { kind: string; id: string }[] }>(`/api/workspaces/${s.ws}/brain/for-you`);
  assert.ok(fy2.body.needsAttention.some((a) => a.kind === "decision_review" && a.id === dec.body.id), JSON.stringify(fy2.body.needsAttention));

  // Weekly reflection: structured sections, not a wall of text.
  const refl = await contributor.post<{ reflection: { headline: string; wins: string[]; nextWeek: string[] }; markdown: string }>(`/api/workspaces/${s.ws}/brain/weekly/summary`, {});
  assert.equal(refl.status, 200, JSON.stringify(refl.body));
  assert.ok(refl.body.reflection.headline && Array.isArray(refl.body.reflection.wins));
  assert.match(refl.body.markdown, /Open loops|Việc còn dang dở/);
});

test("second brain: Ask My Brain is scoped, grounded and traceable; layers and retrospectives stay drafts", async () => {
  type Ask = { answer: string; sources: { n: number; type: string; id: string; used: boolean; historical?: boolean }[]; conversationId: string; grounded: boolean };
  await prisma.aiMessage.deleteMany({ where: { conversation: { userId: { in: [s.viewerId, s.contributorId] } } } });
  const r = await contributor.post<Ask>(`/api/workspaces/${s.ws}/brain/ask`, { question: "How long is probation?", scope: { type: "everything" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.grounded && r.body.sources[0].used, "the cited source is marked");
  assert.ok(r.body.sources.some((x) => x.id === s.brainPageA), "the probation page is a source");
  assert.ok(r.body.sources.some((x) => x.type === "decision" && x.id === s.brainDecision && x.historical), "superseded decisions are flagged as history");
  // A slow but healthy answer (longer than one model attempt) still completes: long calls are streamed and collected.
  const slowAsk = await viewer.post<Ask>(`/api/workspaces/${s.ws}/brain/ask`, { question: "probation #slow-stream", scope: { type: "everything" } });
  assert.equal(slowAsk.status, 200, JSON.stringify(slowAsk.body));
  assert.equal(slowAsk.body.answer, "Slow but complete.");
  await prisma.aiMessage.deleteMany({ where: { conversation: { userId: s.viewerId } } });
  const system = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.match(system, /\[S1\] [A-Z]+:/);
  assert.match(system, /Cite every factual statement/);
  const saved = await prisma.aiMessage.findFirst({ where: { conversationId: r.body.conversationId, role: "model" } });
  assert.ok(Array.isArray(saved?.sources) && (saved!.sources as { used: boolean }[]).some((x) => x.used), "sources are stored with the answer");
  const hist = await contributor.get<{ messages: { sources: unknown }[] }>(`/api/workspaces/${s.ws}/brain/ask?conversationId=${r.body.conversationId}`);
  assert.ok(hist.body.messages[1].sources);

  // Selected sources: exactly those; other people's conversations are private.
  const sel = await contributor.post<Ask>(`/api/workspaces/${s.ws}/brain/ask`, { question: "summarize", scope: { type: "sources", sources: [`task:${s.brainTask}`] } });
  assert.deepEqual(sel.body.sources.map((x) => x.id), [s.brainTask]);
  assert.equal((await viewer.get(`/api/workspaces/${s.ws}/brain/ask?conversationId=${r.body.conversationId}`)).status, 404);
  // A hidden project's pages never become sources, even when asked for directly.
  const secret = await admin.post<{ id: string }>(`/api/wikis/${s.wiki}/pages`, { title: "Other project probation exception", content: "<p>Other project: probation 30 days.</p>" });
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [s.viewerId] });
  const v = await viewer.post<Ask>(`/api/workspaces/${s.ws}/brain/ask`, { question: "probation exception", scope: { type: "sources", sources: [`wiki:${secret.body.id}`, `wiki:${s.brainPageA}`] } });
  assert.deepEqual(v.body.sources.map((x) => x.id), [s.brainPageA]);
  const v2 = await viewer.post<Ask>(`/api/workspaces/${s.ws}/brain/ask`, { question: "probation exception", scope: { type: "everything" } });
  assert.ok(!v2.body.sources.some((x) => x.id === secret.body.id));
  await admin.put(`/api/projects/${s.otherProject}/visibility`, { hiddenUserIds: [] });
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/brain/ask`, { question: "x", scope: { type: "project", projectId: s.otherProject } })).status, 200);
  const mine = await viewer.post<Ask>(`/api/workspaces/${s.ws}/brain/ask`, { question: "probation", scope: { type: "mine" } });
  assert.ok(!mine.body.sources.some((x) => x.id === s.brainPageA), "My notes only = pages I wrote and my journal");

  // Wiki assistant labels superseded knowledge as history.
  assert.equal((await ask(contributor, { kind: "wiki", wikiId: s.wiki, message: "faq?" })).status, 200);
  assert.match((await lastModelRequest()).body.systemInstruction!.parts[0].text, /HR FAQ[^\n]*HISTORICAL - not current/);

  // Progressive summarization: highlights + AI draft; the page content never changes.
  const contentBefore = (await prisma.wikiPage.findUniqueOrThrow({ where: { id: s.brainPageA } })).content;
  const hl = await admin.put<{ highlights: { text: string; blockId?: string }[] }>(`/api/wiki/${s.brainPageA}/layers`, { addHighlight: { text: "Probation lasts 60 days", blockId: "blk00001" } });
  assert.equal(hl.body.highlights[0].blockId, "blk00001");
  const draft = await admin.post<{ keyPoints: string; summary: string; generatedFrom: string }>(`/api/wiki/${s.brainPageA}/layers/generate`, {});
  assert.equal(draft.status, 200, JSON.stringify(draft.body));
  assert.match(draft.body.keyPoints, /Probation is 60 days/);
  assert.equal((await prisma.knowledgeLayer.findUnique({ where: { pageId: s.brainPageA } }))?.summary ?? null, null, "the draft is not saved by itself");
  const savedLayers = await admin.put<{ summary: string; stale: boolean }>(`/api/wiki/${s.brainPageA}/layers`, { summary: draft.body.summary, keyPoints: draft.body.keyPoints, generatedFrom: draft.body.generatedFrom });
  assert.equal(savedLayers.body.summary, "Onboarding summary.");
  assert.equal(savedLayers.body.stale, false);
  assert.equal((await prisma.wikiPage.findUniqueOrThrow({ where: { id: s.brainPageA } })).content, contentBefore, "source untouched");
  assert.equal((await viewer.put(`/api/wiki/${s.brainPageA}/layers`, { summary: "x" })).status, 403);

  // Retrospective of a finished task: a draft, saved as an AI-generated draft page + proposed decisions.
  // The user's AI personalization (e.g. "always answer in Vietnamese") applies here too.
  await contributor.patch("/api/account/profile", { aiInstructions: "Luôn trả lời bằng tiếng Việt." });
  const retro = await contributor.post<{ draft: { title: string; decisions: unknown[] }; source: string }>(`/api/brain/retro`, { taskId: s.brainTask });
  assert.equal(retro.status, 200, JSON.stringify(retro.body));
  assert.equal(retro.body.draft.decisions.length, 1);
  const retroSystem = (await lastModelRequest()).body.systemInstruction!.parts[0].text;
  assert.match(retroSystem, /HISTORY \(status, dates and field changes\)/);
  assert.match(retroSystem, /USER PERSONALIZATION[\s\S]*Luôn trả lời bằng tiếng Việt\./, "personal instructions reach the retrospective");
  assert.match(retroSystem, /unless the USER PERSONALIZATION below asks for a specific language/);
  await contributor.patch("/api/account/profile", { aiInstructions: "" });
  const next = await prisma.task.findFirstOrThrow({ where: { recurrenceParentId: s.brainTask } });
  assert.equal((await contributor.post(`/api/brain/retro`, { taskId: next.id })).status, 400, "only finished tasks");
  const savedRetro = await contributor.post<{ pageId: string; decisionIds: string[] }>(`/api/brain/retro/save`, { wikiId: s.wiki, source: retro.body.source, draft: retro.body.draft, saveDecisions: [0] });
  assert.equal(savedRetro.status, 201, JSON.stringify(savedRetro.body));
  const rp = await prisma.wikiPage.findUniqueOrThrow({ where: { id: savedRetro.body.pageId } });
  assert.equal(rp.kind, "retrospective");
  assert.equal(rp.status, "draft");
  assert.equal(rp.sourceType, "ai_generated");
  assert.equal(rp.sourceRef, `task:${s.brainTask}`);
  const rd = await prisma.decision.findUniqueOrThrow({ where: { id: savedRetro.body.decisionIds[0] } });
  assert.equal(rd.status, "proposed");
  assert.equal(rd.wikiPageId, rp.id);
});
