import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "../client";
import { ADMIN_EMAIL, BASE, prisma, admin, contributor, viewer, outsider, s, ask, lastModelRequest, type Rec } from "./context";

test("platform overview: woli system admins see platform-wide counts; everyone else is refused; each view is logged", async () => {
  assert.equal((await new Client().get("/api/admin/stats")).status, 401);
  assert.equal((await contributor.get("/api/admin/stats")).status, 403, "workspace roles do not grant the platform overview");
  type Overview = { users: { total: number; verified: number }; workspaces: { total: number }; projects: { total: number }; tasks: { total: number }; weekly: { week: string; signups: number }[]; workspaceRows: { id: string; name: string; ownerEmail: string | null; members: number; tasks: number }[] };
  const r = await admin.get<Overview>("/api/admin/stats");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.users.total, await prisma.user.count({ where: { deletedAt: null } }));
  assert.equal(r.body.workspaces.total, await prisma.workspace.count({ where: { deletedAt: null } }));
  assert.equal(r.body.projects.total, await prisma.project.count({ where: { deletedAt: null, workspace: { deletedAt: null } } }));
  assert.equal(r.body.tasks.total, await prisma.task.count({ where: { deletedAt: null, workspace: { deletedAt: null } } }));
  assert.equal(r.body.weekly.length, 12);
  assert.equal(r.body.workspaceRows.length, r.body.workspaces.total, "every workspace is listed, also those the admin is not in");
  const row = r.body.workspaceRows.find((w) => w.id === s.ws)!;
  assert.ok(row && row.ownerEmail && row.members >= 2, JSON.stringify(row));
  assert.equal(row.tasks, await prisma.task.count({ where: { workspaceId: s.ws, deletedAt: null } }));
  assert.ok(!JSON.stringify(r.body).includes("sys_title"), "no task content");
  const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).id;
  assert.ok(await prisma.activityLog.findFirst({ where: { actorId: adminId, action: "admin_overview_viewed" } }), "view logged");

  // AI token report: every Gemini call made by the earlier tests was counted with its workspace, user and route.
  type Ai = { ai: { requests30: number; tokensAll: number }; aiFeatures: { feature: string; requests: number; tokens: number }[]; userRows: { id: string; aiRequests30: number; aiTokens30: number }[]; workspaceRows: { id: string; aiTokens30: number }[] };
  const ai = (r.body as unknown as Ai);
  const events = await prisma.aiUsageEvent.count();
  assert.ok(events > 0, "AI calls were recorded");
  assert.equal(ai.ai.requests30, await prisma.aiUsageEvent.count({ where: { createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } }));
  const sample = await prisma.aiUsageEvent.findFirstOrThrow({ where: { feature: { startsWith: "/api/" } } });
  assert.ok(sample.userId && sample.workspaceId && sample.tokensIn > 0, JSON.stringify(sample));
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}/.test(sample.feature), "ids are replaced in the feature name");
  const byUser = await prisma.aiUsageEvent.groupBy({ by: ["userId"], _sum: { tokensIn: true, tokensOut: true }, where: { userId: { not: null }, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } });
  const top = byUser.sort((a, b) => (b._sum.tokensIn ?? 0) + (b._sum.tokensOut ?? 0) - ((a._sum.tokensIn ?? 0) + (a._sum.tokensOut ?? 0)))[0];
  const topRow = ai.userRows.find((u) => u.id === top.userId)!;
  assert.equal(topRow.aiTokens30, (top._sum.tokensIn ?? 0) + (top._sum.tokensOut ?? 0), "per-user tokens");
  const wsTok = await prisma.aiUsageEvent.aggregate({ _sum: { tokensIn: true, tokensOut: true }, where: { workspaceId: s.ws, createdAt: { gte: new Date(Date.now() - 30 * 86400_000) } } });
  assert.equal(ai.workspaceRows.find((w) => w.id === s.ws)!.aiTokens30, (wsTok._sum.tokensIn ?? 0) + (wsTok._sum.tokensOut ?? 0), "per-workspace tokens");
  assert.ok(ai.aiFeatures.length > 0 && ai.aiFeatures.every((f) => f.requests > 0));
  assert.ok(!JSON.stringify(r.body).includes("RESPONSE_SCHEMA"), "no prompt text in the report");
});

test("workspace AI reads hours, completed dates, parent tasks, custom fields and task files - and a per-person hours table", async () => {
  const A = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Hours data" })).body.id;
  try {
    const field = (await admin.post<{ id: string }>(`/api/projects/${A}/custom-fields`, { name: "Mã hồ sơ", type: "text" })).body.id;
    const P = (await admin.post<Rec>(`/api/projects/${A}/tasks`, { data: { sys_title: "Payroll tháng 10", sys_assignees: [s.contributorId], sys_due_date: "2026-10-30", sys_estimate: 3, sys_actual: 2.5, [field]: "HS-042" } })).body.id;
    await admin.post(`/api/projects/${A}/tasks`, { data: { sys_title: "Đối soát BHXH", sys_parent: [P], sys_assignees: [s.contributorId], sys_due_date: "2026-10-20", sys_estimate: 1, sys_actual: 1.5 } });
    await prisma.attachment.create({ data: { workspaceId: s.ws, taskId: P, fileName: "bang-luong.xlsx", contentType: "application/vnd.ms-excel", sizeBytes: 2048, storageKey: `it/${P}/bang-luong.xlsx`, url: "https://blob.invalid/x", extractedText: "Tổng quỹ lương 1.234.567" } });
    // The admin used up the daily AI quota in earlier tests: move those questions out of the last 24 hours.
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).id;
    await prisma.aiMessage.updateMany({ where: { role: "user", conversation: { userId: adminId } }, data: { createdAt: new Date(Date.now() - 2 * 86400_000) } });
    const r = await ask(admin, { kind: "assistant", workspaceId: s.ws, message: "Tổng giờ actual tháng 10 của từng người?" });
    assert.equal(r.status, 200, r.text);
    const sys = (await lastModelRequest()).body.systemInstruction?.parts.map((p) => p.text).join("\n") ?? "";
    const name = (await prisma.user.findUniqueOrThrow({ where: { id: s.contributorId } })).name;
    assert.match(sys, /estimate h \| actual h/, "task table has hour columns");
    assert.match(sys, /Payroll tháng 10 \|[^\n]*\| 3 \| 2\.5 \|/, "estimate and actual of the task");
    assert.match(sys, new RegExp(`${name} \\| 2026-10 \\| \\d+ \\| \\d+ \\| [\\d.]+ \\| [\\d.]+`), "per-person monthly hours");
    assert.ok(sys.includes("Mã hồ sơ = HS-042"), "custom field values");
    assert.ok(sys.includes("bang-luong.xlsx") && sys.includes("Tổng quỹ lương 1.234.567"), "task files with their text");
    assert.match(sys, /Đối soát BHXH \|[^\n]*\| T-[0-9a-f]{8} \|/, "parent task ref");
  } finally {
    await prisma.attachment.deleteMany({ where: { storageKey: { startsWith: "it/" } } });
    await admin.del(`/api/projects/${A}`);
  }
});

test("comment images: only real images, anyone who may comment can send one, and a comment shows only this task's images", async () => {
  const RICH = "<!--woli-rich-comment:v1-->";
  const send = async (who: Client, taskId: string, name: string, bytes: Uint8Array | string, type: string) => {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart], { type }), name);
    const res = await fetch(`${BASE}/api/tasks/${taskId}/comments/images`, { method: "POST", body: form, headers: { cookie: who.cookieHeader() } });
    return { status: res.status, body: (await res.json().catch(() => null)) as { error?: string } | null };
  };
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  // Not an image (even when it claims to be one) is refused; outsiders can't reach the task.
  assert.equal((await send(admin, s.task1, "x.png", "<svg onload=alert(1)>", "image/png")).status, 400);
  assert.equal((await send(admin, s.task1, "page.html", "<html></html>", "text/html")).status, 400);
  assert.equal((await send(outsider, s.task1, "a.png", png, "image/png")).status, 404);
  // A real image from a viewer passes the checks (the test server has no file storage, hence 503).
  assert.equal((await send(viewer, s.task1, "shot.png", png, "image/png")).status, 503);

  // The comment keeps images of its own task only; other tasks' files and outside URLs are dropped.
  const mine = await prisma.attachment.create({ data: { workspaceId: s.ws, taskId: s.task1, fileName: "shot.png", contentType: "image/png", sizeBytes: 16, storageKey: `it/${s.task1}/shot.png`, url: "https://blob.invalid/shot.png" } });
  const other = await prisma.attachment.create({ data: { workspaceId: s.ws, taskId: s.task2, fileName: "other.png", contentType: "image/png", sizeBytes: 16, storageKey: `it/${s.task2}/other.png`, url: "https://blob.invalid/other.png" } });
  try {
    const img = (id: string) => `<img src="/api/attachments/${id}/download?inline=1" alt="a">`;
    const body = `${RICH}<p>Lỗi đây</p>${img(mine.id)}${img(other.id)}<img src="https://evil.example/pixel.gif"><img src="/api/attachments/${mine.id}/download">`;
    const c = await viewer.post<{ id: string; body: string }>(`/api/tasks/${s.task1}/comments`, { body });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const saved = (await prisma.comment.findUniqueOrThrow({ where: { id: c.body.id } })).body;
    assert.equal((saved.match(/<img/g) ?? []).length, 1, saved);
    assert.ok(saved.includes(`/api/attachments/${mine.id}/download?inline=1`) && !saved.includes(other.id) && !saved.includes("evil.example"), saved);
    // A comment with only an image is fine; one whose only image is not allowed is empty.
    assert.equal((await viewer.post(`/api/tasks/${s.task1}/comments`, { body: `${RICH}${img(mine.id)}` })).status, 201);
    assert.equal((await viewer.post(`/api/tasks/${s.task1}/comments`, { body: `${RICH}${img(other.id)}` })).status, 400);
    // Editing keeps the same rule.
    const edited = await viewer.patch<{ body: string }>(`/api/comments/${c.body.id}`, { body: `${RICH}<p>Sửa</p>${img(other.id)}${img(mine.id)}` });
    assert.equal(edited.status, 200);
    assert.equal((edited.body.body.match(/<img/g) ?? []).length, 1);
  } finally {
    await prisma.attachment.deleteMany({ where: { storageKey: { startsWith: "it/" } } });
  }
});

test("phone app (PWA): manifest, icons, service worker, offline page and build id are public and correct", async () => {
  const get = (path: string) => fetch(`${BASE}${path}`);
  const m = await get("/manifest.webmanifest");
  assert.equal(m.status, 200);
  const manifest = (await m.json()) as { display: string; start_url: string; scope: string; icons: { src: string; sizes: string; purpose?: string }[] };
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.scope, "/");
  assert.ok(manifest.start_url.startsWith("/workspaces"));
  assert.ok(manifest.icons.some((i) => i.sizes === "192x192") && manifest.icons.some((i) => i.sizes === "512x512") && manifest.icons.some((i) => i.purpose === "maskable"));
  for (const icon of manifest.icons) {
    const r = await get(icon.src);
    assert.equal(r.status, 200, icon.src);
    assert.equal(r.headers.get("content-type"), "image/png");
  }
  const sw = await get("/sw.js");
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get("cache-control") ?? "", /no-cache/, "a new service worker is picked up at once");
  const swText = await sw.text();
  assert.ok(swText.includes('url.pathname.startsWith("/api/")'), "API responses are never cached");
  assert.equal((await get("/offline.html")).status, 200);
  const v = await get("/api/version");
  assert.equal(v.status, 200);
  assert.equal(v.headers.get("cache-control"), "no-store");
  assert.ok(((await v.json()) as { buildId: string }).buildId.length > 0);
  const page = await (await get("/")).text();
  assert.ok(page.includes('rel="manifest"') && page.includes("apple-mobile-web-app-capable"), "pages link the manifest and the iOS app tags");

  // Android app: Digital Asset Links for the TWA, and APK releases registered as platform "android".
  const links = (await (await get("/.well-known/assetlinks.json")).json()) as { target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] } }[];
  assert.equal(links[0].target.namespace, "android_app");
  assert.equal(links[0].target.package_name, "vn.woli.app");
  assert.match(links[0].target.sha256_cert_fingerprints[0], /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  const launch = await fetch(`${BASE}/android-app?v=1.0.0`, { redirect: "manual" });
  assert.equal(launch.status, 200, "the app's start address is public (it continues to sign-in itself)");
  assert.equal((await get("/api/desktop/releases/latest?platform=android")).status, 404, "no APK yet");
  const apk = await admin.post("/api/desktop/releases", { version: "1.0.0", platform: "android", installerUrl: "https://github.com/diuthihieu/hr-task-managent-CL/releases/download/android-v1.0.0/woli-android-1.0.0.apk", installerFileName: "woli-android-1.0.0.apk", installerSizeBytes: 2_000_000, sha256: "a".repeat(64), minOsVersion: "Android 7.0+" });
  assert.equal(apk.status, 201, JSON.stringify(apk.body));
  try {
    const latest = (await (await get("/api/desktop/releases/latest?platform=android")).json()) as { version: string; platform: string };
    assert.equal(latest.version, "1.0.0");
    assert.equal(latest.platform, "android");
    const dl = await fetch(`${BASE}/api/desktop/download/latest?platform=android`, { redirect: "manual" });
    assert.equal(dl.status, 302);
    assert.match(dl.headers.get("location") ?? "", /woli-android-1\.0\.0\.apk$/);
    // The Windows download is unaffected by the Android release.
    const win = await fetch(`${BASE}/api/desktop/download/latest`, { redirect: "manual" });
    assert.doesNotMatch(win.headers.get("location") ?? "", /\.apk$/);
    // The desktop updater never serves the APK.
    assert.equal((await get("/api/desktop/update/android/x/0.1.0")).status, 204);
  } finally {
    await prisma.desktopRelease.deleteMany({ where: { platform: "android" } });
  }
});

test("sub-task dates stay inside the parent task's dates; a parent cannot shrink past its sub-tasks", async () => {
  const A = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Sub-task dates" })).body.id;
  try {
    const mk = (data: object) => admin.post<Rec & { error?: string }>(`/api/projects/${A}/tasks`, { data });
    const P = (await mk({ sys_title: "Parent", sys_start_date: "2026-11-01", sys_due_date: "2026-11-30" })).body.id;
    // Created inside the range: fine; outside: refused (also when only one end is outside).
    const C = await mk({ sys_title: "Child", sys_parent: [P], sys_start_date: "2026-11-05", sys_due_date: "2026-11-20" });
    assert.equal(C.status, 201, JSON.stringify(C.body));
    assert.equal((await mk({ sys_title: "Too late", sys_parent: [P], sys_due_date: "2026-12-02" })).status, 400);
    assert.equal((await mk({ sys_title: "Too early", sys_parent: [P], sys_start_date: "2026-10-31" })).status, 400);
    assert.equal((await mk({ sys_title: "No dates", sys_parent: [P] })).status, 201, "a sub-task without dates is fine");
    // Editing the child's dates or attaching a dated task to the parent is checked too.
    const bad = await admin.patch<{ error?: string }>(`/api/tasks/${C.body.id}`, { data: { sys_due_date: "2026-12-15" } });
    assert.equal(bad.status, 400);
    assert.match(JSON.stringify(bad.body), /task mẹ/);
    const loose = (await mk({ sys_title: "Loose", sys_start_date: "2026-12-01" })).body.id;
    assert.equal((await admin.patch(`/api/tasks/${loose}`, { data: { sys_parent: [P] } })).status, 400);
    // The parent's range cannot shrink so the child falls outside; widening is fine.
    assert.equal((await admin.patch(`/api/tasks/${P}`, { data: { sys_due_date: "2026-11-10" } })).status, 400);
    assert.equal((await admin.patch(`/api/tasks/${P}`, { data: { sys_due_date: "2026-12-31" } })).status, 200);
    assert.equal((await admin.patch(`/api/tasks/${C.body.id}`, { data: { sys_due_date: "2026-12-15" } })).status, 200);
    // A parent without dates puts no limit on its sub-tasks.
    const Q = (await mk({ sys_title: "Open parent" })).body.id;
    assert.equal((await mk({ sys_title: "Any date", sys_parent: [Q], sys_due_date: "2030-01-01" })).status, 201);
  } finally {
    await admin.del(`/api/projects/${A}`);
  }
});

test("grid rows: insert N rows above / below a task in place (group value, parent kept); bulk delete follows delete rights", async () => {
  const A = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Insert rows" })).body.id;
  try {
    const cat = (await admin.post<{ id: string }>(`/api/projects/${A}/categories`, { name: "Tuyển dụng", color: "#ff0000" })).body.id;
    const mk = async (title: string, data: object = {}) => (await admin.post<Rec>(`/api/projects/${A}/tasks`, { data: { sys_title: title, ...data } })).body.id;
    const t1 = await mk("T1");
    const t2 = await mk("T2", { sys_category: cat });
    const t3 = await mk("T3");
    const child = await mk("T2 child", { sys_parent: [t2] });
    const titles = async () => (await admin.get<Rec[]>(`/api/projects/${A}/tasks`)).body.map((r) => String(r.data.sys_title));
    const insert = (who: Client, body: object) => who.post<{ records: Rec[] }>(`/api/projects/${A}/tasks/insert`, body);

    // Below T2, 2 rows, in T2's group (category) and at T2's level.
    const below = await insert(admin, { anchorId: t2, position: "below", count: 2, data: { sys_title: "New", sys_category: cat } });
    assert.equal(below.status, 201, JSON.stringify(below.body));
    assert.equal(below.body.records.length, 2);
    assert.ok(below.body.records.every((r) => r.data.sys_category === cat), "group value written");
    assert.deepEqual(await titles(), ["T1", "T2", "New", "New", "T3", "T2 child"]);
    // Above T1 (the first row), and above T3 as sub-tasks of T2 (parent kept).
    assert.equal((await insert(admin, { anchorId: t1, position: "above", count: 1, data: { sys_title: "Top" } })).status, 201);
    const sub = await insert(admin, { anchorId: t3, position: "above", count: 1, data: { sys_title: "Sib", sys_parent: [t2] } });
    assert.deepEqual(sub.body.records[0].data.sys_parent, [t2]);
    assert.deepEqual(await titles(), ["Top", "T1", "T2", "New", "New", "Sib", "T3", "T2 child"]);

    // Limits and validation: count 1..50, the anchor must be a live task of this project, bad data rolls back.
    assert.equal((await insert(admin, { anchorId: t1, position: "below", count: 51 })).status, 400);
    assert.equal((await insert(admin, { anchorId: t1, position: "below", count: 0 })).status, 400);
    assert.equal((await insert(admin, { anchorId: s.task1, position: "below", count: 1 })).status, 404, "anchor from another project");
    const before = (await titles()).length;
    assert.notEqual((await insert(admin, { anchorId: t1, position: "below", count: 3, data: { sys_parent: [s.task1] } })).status, 201, "parent from another project");
    assert.equal((await titles()).length, before, "nothing half-inserted");
    // Rights: viewers and outsiders can't insert.
    assert.equal((await insert(viewer, { anchorId: t1, position: "below", count: 1 })).status, 403);
    assert.equal((await insert(outsider, { anchorId: t1, position: "below", count: 1 })).status, 404);

    // Bulk delete: a contributor may not delete tasks they neither created nor are assigned to...
    const del = (who: Client, ids: string[]) => who.post<{ deleted: number }>(`/api/projects/${A}/tasks/bulk-delete`, { ids });
    assert.equal((await del(contributor, [t1])).status, 403);
    assert.equal((await del(viewer, [t1])).status, 403);
    const own = (await contributor.post<Rec>(`/api/projects/${A}/tasks`, { data: { sys_title: "Mine" } })).body.id;
    assert.equal((await del(contributor, [own, t1])).status, 403, "one foreign task refuses the whole request");
    assert.ok(await prisma.task.findFirst({ where: { id: own, deletedAt: null } }), "nothing deleted");
    // ...but their own, yes; editors+ delete any task. Sub-tasks of a deleted task are kept.
    assert.equal((await del(contributor, [own])).body.deleted, 1);
    const r = await del(admin, [t2]);
    assert.equal(r.body.deleted, 1);
    assert.ok(await prisma.task.findFirst({ where: { id: child, deletedAt: null } }), "sub-task kept");
    // Without "delete tasks" in the project nobody below admin deletes.
    assert.equal((await admin.put(`/api/projects/${A}/permissions`, { changes: [{ userId: s.contributorId, permissions: ["task.create", "task.edit_own"] }] })).status, 200);
    const own2 = (await contributor.post<Rec>(`/api/projects/${A}/tasks`, { data: { sys_title: "Mine 2" } })).body.id;
    assert.equal((await del(contributor, [own2])).status, 403);
  } finally {
    await admin.del(`/api/projects/${A}`);
  }
});

test("comment -> task suggestion: AI proposes a task only to the comment's author, within projects they may create in; model output is re-checked", async () => {
  const wsBefore = await prisma.workspace.findUniqueOrThrow({ where: { id: s.ws }, select: { aiEnabled: true } });
  const roles = await prisma.workspaceMember.findMany({ where: { workspaceId: s.ws, userId: { in: [s.contributorId, s.viewerId] } }, select: { userId: true, role: true } });
  await prisma.workspace.update({ where: { id: s.ws }, data: { aiEnabled: true } });
  await prisma.workspaceMember.updateMany({ where: { workspaceId: s.ws, userId: s.contributorId }, data: { role: "contributor" } });
  await prisma.workspaceMember.updateMany({ where: { workspaceId: s.ws, userId: s.viewerId }, data: { role: "viewer" } });
  const P = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Comment AI project" })).body.id;
  try {
    const T = (await admin.post<Rec>(`/api/projects/${P}/tasks`, { data: { sys_title: "Tuyển kỹ sư" } })).body.id;
    const contributorName = (await prisma.user.findUniqueOrThrow({ where: { id: s.contributorId } })).name;
    const say = async (who: Client, body: string) => (await who.post<{ id: string }>(`/api/tasks/${T}/comments`, { body })).body.id;
    type Sug = { suggest: boolean; reason?: string; draft?: { title: string; projectId: string; dueDate: string | null; priority: string; assigneeIds: string[]; asSubtask: boolean }; projects?: { id: string }[] };
    const ask = (who: Client, commentId: string) => who.post<Sug>(`/api/tasks/${T}/comments/${commentId}/task-suggestion`);

    const c1 = await say(admin, `Nhờ @[${contributorName}](${s.contributorId}) gửi hợp đồng cho ứng viên Lan trước 31/12`);
    const r1 = await ask(admin, c1);
    assert.equal(r1.status, 200, JSON.stringify(r1.body));
    assert.equal(r1.body.suggest, true, JSON.stringify(r1.body));
    assert.equal(r1.body.draft!.title, "Gửi hợp đồng cho ứng viên");
    assert.equal(r1.body.draft!.projectId, P, "the commented task's project comes first");
    assert.equal(r1.body.draft!.dueDate, "2026-12-31");
    assert.deepEqual(r1.body.draft!.assigneeIds, [s.contributorId], "the mentioned person is proposed");
    assert.equal(r1.body.draft!.asSubtask, true);
    assert.ok(r1.body.projects!.every((p) => p.id), "only projects the author can create in");

    // Only the author; outsiders do not even see the task.
    assert.equal((await ask(contributor, c1)).status, 403);
    assert.equal((await ask(outsider, c1)).status, 404);
    assert.equal((await admin.post(`/api/tasks/${T}/comments/00000000-0000-4000-8000-000000000000/task-suggestion`)).status, 404);

    // Not a task / too short.
    assert.deepEqual((await ask(admin, await say(admin, "Cập nhật: đã xong phần phỏng vấn #notask"))).body, { suggest: false, reason: "not_task" });
    assert.equal((await ask(admin, await say(admin, "ok"))).body.reason, "short");

    // Ids the model invents are dropped; bad dates / priorities fall back.
    const h = (await ask(admin, await say(admin, "Please prepare everything for onboarding #hallucinate"))).body;
    assert.equal(h.suggest, true);
    assert.equal(h.draft!.projectId, P);
    assert.deepEqual(h.draft!.assigneeIds, []);
    assert.equal(h.draft!.dueDate, null);
    assert.equal(h.draft!.priority, "medium");

    // A viewer can comment but create tasks nowhere: no proposal.
    const cv = await say(viewer, "Nhờ mọi người chuẩn bị phòng họp cho buổi phỏng vấn ngày mai");
    assert.equal((await ask(viewer, cv)).body.reason, "no_project");

    // AI switched off for the workspace: silently no proposal.
    await prisma.workspace.update({ where: { id: s.ws }, data: { aiEnabled: false } });
    assert.deepEqual((await ask(admin, c1)).body, { suggest: false, reason: "ai_off" });
    await prisma.workspace.update({ where: { id: s.ws }, data: { aiEnabled: true } });

    // Confirming goes through the normal task API (sub-task of the commented task).
    const made = await admin.post<Rec>(`/api/projects/${P}/tasks`, { data: { sys_title: r1.body.draft!.title, sys_parent: [T], sys_assignees: r1.body.draft!.assigneeIds, sys_due_date: r1.body.draft!.dueDate, sys_priority: r1.body.draft!.priority } });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.deepEqual(made.body.data.sys_parent, [T]);
    // A contributor can't put a task into a project they may not create in.
    await prisma.projectMemberPermission.upsert({ where: { projectId_userId: { projectId: P, userId: s.contributorId } }, create: { projectId: P, userId: s.contributorId, permissions: ["task.comment"] }, update: { permissions: ["task.comment"] } });
    assert.equal((await contributor.post(`/api/projects/${P}/tasks`, { data: { sys_title: "x" } })).status, 403);
    const cc = await say(contributor, "Mình sẽ chuẩn bị bộ câu hỏi phỏng vấn cho vòng 2 vào thứ sáu");
    const rc = (await ask(contributor, cc)).body;
    assert.ok(!rc.suggest || rc.draft!.projectId !== P, "a project without create rights is never proposed");
  } finally {
    await prisma.projectMemberPermission.deleteMany({ where: { projectId: P } });
    for (const r of roles) await prisma.workspaceMember.updateMany({ where: { workspaceId: s.ws, userId: r.userId }, data: { role: r.role } });
    await prisma.workspace.update({ where: { id: s.ws }, data: { aiEnabled: wsBefore.aiEnabled } });
    await admin.del(`/api/projects/${P}`);
  }
});

test("project owner ranks above the workspace owner; hand-over with checks; roles are saved in batch; exactly one workspace owner", async () => {
  const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).id;
  const setRole = (userId: string, role: "editor" | "contributor" | "viewer") => prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: s.ws, userId } }, data: { role } });
  const original = (await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: s.ws, userId: s.contributorId } } })).role;
  const proj = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Owned by Casey" })).body.id;
  try {
    // Exactly one owner: no owner through role changes.
    assert.equal((await admin.patch(`/api/workspaces/${s.ws}/members/${s.contributorId}`, { role: "owner" })).status, 403);
    assert.equal((await admin.put(`/api/workspaces/${s.ws}/members/roles`, { changes: [{ userId: s.contributorId, role: "owner" }] })).status, 400);
    // Batch save: all or nothing.
    assert.equal((await admin.put(`/api/workspaces/${s.ws}/members/roles`, { changes: [{ userId: s.contributorId, role: "editor" }, { userId: adminId, role: "admin" }] })).status, 403, "the owner's own row can't change here");
    assert.equal((await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: s.ws, userId: s.contributorId } } })).role, original, "nothing applied");
    assert.equal((await admin.put(`/api/workspaces/${s.ws}/members/roles`, { changes: [{ userId: s.contributorId, role: "editor" }] })).status, 200);

    // Hand-over: contributors/viewers can't own; then Casey (editor) owns the project.
    await setRole(s.contributorId, "contributor");
    assert.equal((await admin.post(`/api/projects/${proj}/owner`, { toUserId: s.contributorId })).status, 400);
    await setRole(s.contributorId, "editor");
    assert.equal((await admin.patch(`/api/projects/${proj}`, { ownerId: s.contributorId })).status, 400, "only through hand-over");
    assert.equal((await admin.post(`/api/projects/${proj}/owner`, { toUserId: s.contributorId })).status, 200);
    assert.equal((await admin.post(`/api/projects/${proj}/owner`, { toUserId: adminId })).status, 403, "the former owner no longer runs it");
    assert.ok(await prisma.notification.findFirst({ where: { userId: s.contributorId, type: "project_owner", projectId: proj } }));

    // The project owner narrows the workspace owner, then hides the project from them.
    assert.equal((await admin.get(`/api/projects/${proj}/permissions`)).status, 403);
    const put = await contributor.put(`/api/projects/${proj}/permissions`, { changes: [{ userId: adminId, permissions: ["task.comment"] }] });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal((await admin.post(`/api/projects/${proj}/tasks`, { data: { sys_title: "Owner blocked" } })).status, 403, "workspace owner narrowed inside the project");
    assert.equal((await admin.patch(`/api/projects/${proj}`, { description: "x" })).status, 403);
    // Restoring a deleted task needs the same right as deleting it.
    const binned = (await contributor.post<{ id: string }>(`/api/projects/${proj}/tasks`, { data: { sys_title: "Binned by Casey" } })).body.id;
    assert.equal((await contributor.del(`/api/tasks/${binned}`)).status, 204);
    assert.equal((await admin.post(`/api/tasks/${binned}/restore`)).status, 403, "a narrowed workspace owner can't restore");
    const viewId = (await prisma.view.findFirstOrThrow({ where: { projectId: proj } })).id;
    await contributor.post(`/api/projects/${proj}/views`, { name: "Second", type: "kanban" });
    const other = (await prisma.view.findFirstOrThrow({ where: { projectId: proj, id: { not: viewId } } })).id;
    assert.equal((await admin.del(`/api/views/${other}`)).status, 403, "narrowed workspace owner can't delete shared views");
    assert.equal((await admin.del(`/api/views/${viewId}`)).status, 403, "nor the base view");
    // Project owners must stay editors or above.
    assert.equal((await admin.put(`/api/workspaces/${s.ws}/members/roles`, { changes: [{ userId: s.contributorId, role: "contributor" }] })).status, 400, "hand over their projects first");
    assert.equal((await admin.post(`/api/workspaces/${s.ws}/projects`, { name: "x", ownerId: s.viewerId })).status, 400, "viewer can't own a project");
    assert.equal((await contributor.put(`/api/projects/${proj}/permissions`, { changes: [{ userId: s.contributorId, permissions: [] }] })).status, 400, "the project owner stays full");
    assert.equal((await contributor.put(`/api/projects/${proj}/permissions`, { changes: [{ userId: adminId, hidden: true }] })).status, 200);
    assert.equal((await admin.get(`/api/projects/${proj}`)).status, 404, "hidden from the workspace owner");
    const restored = await admin.post<{ id?: string; title?: string }>(`/api/tasks/${binned}/restore`);
    assert.equal(restored.status, 404, "a task of a hidden project can't be restored (nor its record read)");
    assert.equal(restored.body.title, undefined);
    assert.ok((await prisma.task.findUniqueOrThrow({ where: { id: binned } })).deletedAt, "still deleted");
    // The workspace audit log leaves out what happened inside the hidden project.
    type Log = { entityId: string; summary: string | null }[];
    const mentionsBinned = (rows: Log) => rows.filter((r) => r.entityId === binned || r.summary?.includes("Binned by Casey")).length;
    const hiddenLog = await admin.get<Log>(`/api/workspaces/${s.ws}/activity?limit=200`);
    assert.equal(hiddenLog.status, 200);
    assert.equal(mentionsBinned(hiddenLog.body), 0, "no audit rows about a hidden project's tasks");
    assert.ok(!hiddenLog.body.some((r) => r.entityId === proj), "nor about the hidden project itself");
    assert.ok(hiddenLog.body.length > 0, "the rest of the log is still there");

    // Recovery: workspace admins hand over a member's projects (e.g. a leaver).
    assert.equal((await admin.post(`/api/workspaces/${s.ws}/members/${s.contributorId}/handover`, { toUserId: adminId })).status, 200);
    assert.equal((await admin.get(`/api/projects/${proj}`)).status, 200, "the new owner sees it again");
    assert.ok(mentionsBinned((await admin.get<Log>(`/api/workspaces/${s.ws}/activity?limit=200`)).body) >= 2, "and its audit rows are back");
  } finally {
    await prisma.projectMemberPermission.deleteMany({ where: { projectId: proj } });
    await prisma.projectHiddenMember.deleteMany({ where: { projectId: proj } });
    await prisma.project.update({ where: { id: proj }, data: { ownerId: adminId } });
    await admin.del(`/api/projects/${proj}`);
    await setRole(s.contributorId, original as "contributor");
  }
});

test("every table has row level security on (nothing is readable around the app through a hosted data API)", async () => {
  const off = await prisma.$queryRaw<{ relname: string }[]>`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity ORDER BY 1`;
  assert.deepEqual(off.map((r) => r.relname), [], "a migration that creates a table must also ENABLE ROW LEVEL SECURITY on it");
  // The app still reads and writes as the table owner.
  assert.ok((await prisma.user.count()) > 0);
});

test("attachments require object storage; nothing is written when it's not configured", async () => {
  if (process.env.BLOB_READ_WRITE_TOKEN) return;
  const form = new FormData();
  form.append("file", new Blob(["hello"], { type: "text/plain" }), "note.txt");
  const res = await fetch(`${process.env.TEST_BASE_URL ?? "http://localhost:3100"}/api/tasks/${s.task1}/attachments`, {
    method: "POST",
    body: form,
    headers: { cookie: admin.cookieHeader() },
  });
  assert.equal(res.status, 503);
  assert.equal(await prisma.attachment.count(), 0);
});

test("database triggers block cross-workspace references even if the API had a bug", async () => {
  const other = await admin.post<{ id: string }>("/api/workspaces", { name: "Other Co" });
  const otherStatus = (await admin.get<{ id: string }[]>(`/api/workspaces/${other.body.id}/statuses`)).body[0].id;
  await assert.rejects(prisma.task.update({ where: { id: s.task1 }, data: { statusId: otherStatus } }), /status must belong/);
  await assert.rejects(prisma.taskAssignee.create({ data: { taskId: s.task1, userId: s.outsiderId } }), /assignee must be a member/);
});

test("deactivating an account revokes access immediately, even with a live session", async () => {
  assert.equal((await contributor.get(`/api/projects/${s.project}`)).status, 200);
  assert.equal((await admin.patch(`/api/admin/users/${s.contributorId}`, { isActive: false })).status, 200);
  assert.equal((await contributor.get(`/api/projects/${s.project}`)).status, 401);
  assert.equal(await new Client().login("contributor@integration.test", "Contrib123"), false);
  // The last admin can't lock themselves out.
  const me = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
  assert.equal((await admin.patch(`/api/admin/users/${me.id}`, { isActive: false })).status, 400);
});

test("security: stolen sessions die on reset, sign-in is throttled, public forms don't expose people, viewers can't log time", async () => {
  // Session revocation: an admin password reset kills every existing cookie of that account.
  const before = await outsider.get("/api/workspaces");
  assert.equal(before.status, 200);
  const stolen = outsider.clone();
  const reset = await admin.patch<{ temporaryPassword: string }>(`/api/admin/users/${s.outsiderId}`, { resetPassword: true });
  assert.equal(reset.status, 200);
  assert.equal((await outsider.get("/api/workspaces")).status, 401, "the old cookie no longer works");
  // The revoked cookie can't be revived or extended through the session endpoint.
  const revived = await stolen.updateSession({});
  assert.ok(!revived.body?.user, "POST /api/auth/session returns no session for a revoked cookie");
  assert.equal((await stolen.get("/api/workspaces")).status, 401, "POST /api/auth/session doesn't revive a revoked cookie");
  const extended = await outsider.clone().get<{ user?: unknown } | null>("/api/auth/session");
  assert.ok(!extended.body?.user, "GET /api/auth/session doesn't re-sign a revoked cookie");
  assert.ok(await outsider.login("outsider@integration.test", reset.body.temporaryPassword));
  const copy = outsider.clone();
  assert.equal((await outsider.post("/api/account/password", { currentPassword: reset.body.temporaryPassword, newPassword: "Outsider456" })).status, 200);
  assert.equal((await outsider.get("/api/workspaces")).status, 200, "the device that changed its password stays signed in");
  assert.equal((await copy.updateSession({ svProof: "forged.proof" })).status, 200);
  assert.equal((await copy.get("/api/workspaces")).status, 401, "a forged refresh proof is ignored");
  assert.equal((await stolen.get("/api/workspaces")).status, 401);

  // Sign-in throttling is per account and shared by all instances (database counters).
  const victim = new Client();
  assert.equal((await victim.post("/api/register", { email: "throttle@integration.test", password: "Throttle123", name: "Throttle" })).status, 201);
  for (let i = 0; i < 10; i++) assert.equal(await victim.login("throttle@integration.test", `wrong-${i}`), false);
  assert.equal(await victim.login("throttle@integration.test", "Throttle123"), false, "even the right password waits once the account is throttled");
  assert.ok(await prisma.activityLog.findFirst({ where: { action: "sign_in_throttled" } }), "throttling is audit-logged");
  assert.ok(await prisma.activityLog.findFirst({ where: { action: "sign_in_failed", ip: { not: null } } }), "failed sign-ins carry the client address");
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "login-" } } });
  assert.ok(await victim.login("throttle@integration.test", "Throttle123"));

  // Public forms: no people fields, no staff list, anonymous submissions rate limited.
  const view = await prisma.view.create({ data: { projectId: s.project, name: "Public intake", type: "form", isPublic: true, config: {} } });
  const anon = new Client();
  const form = await anon.get<{ fields: { id: string; type: string }[]; members: unknown[] }>(`/api/public/forms/${view.id}`);
  assert.equal(form.status, 200);
  assert.deepEqual(form.body.members, [], "the member list is never published");
  assert.ok(form.body.fields.length > 0 && !form.body.fields.some((f) => f.type === "person" || f.type === "people"), "people fields are not offered anonymously");
  const sub = await anon.post(`/api/public/forms/${view.id}`, { data: { sys_title: "From the internet", sys_assignees: [s.contributorId] } });
  assert.equal(sub.status, 201);
  const created = await prisma.task.findFirstOrThrow({ where: { title: "From the internet" }, include: { assignees: true } });
  assert.equal(created.assignees.length, 0, "strangers can't assign (and notify) staff");
  let limited = 0;
  for (let i = 0; i < 12; i++) if ((await anon.post(`/api/public/forms/${view.id}`, { data: { sys_title: `Spam ${i}` } })).status === 429) limited++;
  assert.ok(limited >= 2, "anonymous submissions are rate limited");

  // Focus: a viewer may keep a personal focus record but can't add time to someone's task.
  const t = await prisma.task.findFirstOrThrow({ where: { projectId: s.project, deletedAt: null }, select: { id: true, actualMinutes: true } });
  const f = await viewer.post<{ id: string }>(`/api/tasks/${t.id}/focus`, {});
  assert.equal(f.status, 201);
  await prisma.focusSession.update({ where: { id: f.body.id }, data: { elapsedSeconds: 600, resumedAt: null, status: "paused" } });
  assert.equal((await viewer.patch(`/api/focus/${f.body.id}`, { action: "complete" })).status, 200);
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).actualMinutes, t.actualMinutes, "actual time unchanged");
  assert.equal((await viewer.patch(`/api/focus/${f.body.id}`, { action: "complete", completeTask: true })).status, 400, "ended sessions can't be reused");

  // After sign-in, ?callbackUrl= only ever leads to a page of this site.
  const home = (q: string) => fetch(`${BASE}/?${q}`, { redirect: "manual", headers: { cookie: viewer.cookieHeader() } });
  for (const evil of ["%2F%5Cexample.com", "%2F%09%2Fexample.com", "%2F%2Fexample.com", "https%3A%2F%2Fexample.com"]) {
    const r = await home(`callbackUrl=${evil}`);
    assert.ok([303, 307, 308].includes(r.status), `${evil}: ${r.status}`);
    assert.equal(new URL(r.headers.get("location")!, BASE).href, `${BASE}/workspaces`, `${evil} stays on the site`);
  }
  const inApp = await home("callbackUrl=%2Finvite%2Fabc");
  assert.equal(new URL(inApp.headers.get("location")!, BASE).pathname, "/invite/abc", "an in-app path is kept");
  const twice = await home("callbackUrl=a&callbackUrl=b");
  assert.ok(twice.status < 500, `a repeated parameter doesn't break the page (${twice.status})`);

  // Security headers on every page.
  const page = await fetch(`${BASE}/`);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'self'/);
  assert.equal(page.headers.get("x-powered-by"), null);
  const health = await fetch(`${BASE}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(Object.keys(await health.json()).sort(), ["db", "ms", "status"]);

  // The audit log can't be edited or deleted, even with the app's database credentials.
  const row = await prisma.activityLog.findFirstOrThrow();
  await assert.rejects(prisma.activityLog.delete({ where: { id: row.id } }), /append-only/);
});

test("forgot password: no mail → clear 503; a signed link resets once and signs other devices out", async () => {
  const { resetToken } = await import("../../../src/lib/password-reset-token");
  const anon = new Client();
  const unavailable = await anon.post<{ code?: string }>("/api/account/password-reset/request", { email: "contributor@integration.test" });
  assert.equal(unavailable.status, 503, "test server has no mail provider");
  assert.equal(unavailable.body.code, "mail_unavailable");

  const reg = await anon.post<{ id: string }>("/api/register", { email: "forgetful@integration.test", password: "OldPass123", name: "Fran Forgetful" });
  assert.equal(reg.status, 201);
  const other = new Client();
  assert.ok(await other.login("forgetful@integration.test", "OldPass123"));
  const u = await prisma.user.findUniqueOrThrow({ where: { id: reg.body.id }, select: { id: true, passwordHash: true, sessionVersion: true } });
  const token = resetToken(u);

  assert.equal((await anon.post("/api/account/password-reset/confirm", { token: token + "x", password: "NewPass456" })).status, 400, "tampered");
  assert.equal((await anon.post("/api/account/password-reset/confirm", { token, password: "short" })).status, 400, "password policy");
  assert.equal((await anon.post("/api/account/password-reset/confirm", { token: resetToken(u, Date.now() - 2 * 3600_000), password: "NewPass456" })).status, 400, "expired");
  // Two confirmations racing with the same token: exactly one wins.
  const [ra, rb] = await Promise.all([
    anon.post("/api/account/password-reset/confirm", { token, password: "NewPass456" }),
    new Client().post("/api/account/password-reset/confirm", { token, password: "RacePass789" }),
  ]);
  assert.deepEqual([ra.status, rb.status].sort(), [200, 400], "single use under concurrency");
  const ok = ra.status === 200 ? ra : rb;
  const winner = ra.status === 200 ? "NewPass456" : "RacePass789";
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const reused = await anon.post<{ code?: string }>("/api/account/password-reset/confirm", { token, password: "Another789" });
  assert.equal(reused.status, 400, "works once");
  assert.equal(reused.body.code, "invalid_token");

  const after = await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { emailVerifiedAt: true } });
  assert.ok(after.emailVerifiedAt, "opening the emailed link proves the address");
  assert.equal((await other.get("/api/account/profile")).status, 401, "other devices are signed out");
  await other.updateSession({});
  assert.equal((await other.get("/api/account/profile")).status, 401, "and can't sign back in through POST /api/auth/session");
  assert.equal(await new Client().login("forgetful@integration.test", "OldPass123"), false);
  assert.ok(await new Client().login("forgetful@integration.test", winner));
});
