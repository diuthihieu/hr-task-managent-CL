import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "../client";
import { ADMIN_EMAIL, prisma, admin, contributor, viewer, outsider, s, lastModelRequest, action, type Rec } from "./context";

test("invite links and invitations for people without an account: accept, decline, revoke, replace", async () => {
  const ws = await admin.post<{ id: string }>("/api/workspaces", { name: "Invite Co" });
  // Join link: off by default; admins turn it on and pick the role.
  assert.equal((await admin.get<{ enabled: boolean }>(`/api/workspaces/${ws.body.id}/invite-link`)).body.enabled, false);
  assert.equal((await admin.post(`/api/workspaces/${ws.body.id}/invite-link`, { role: "admin" })).status, 400, "links never grant admin");
  const on = await admin.post<{ enabled: boolean; url: string; role: string }>(`/api/workspaces/${ws.body.id}/invite-link`, { role: "viewer" });
  assert.equal(on.body.enabled, true);
  const token = on.body.url.split("/invite/")[1];
  assert.equal((await outsider.get<{ kind: string; state: string }>(`/api/invite/${token}`)).body.kind, "link");
  assert.equal(await prisma.workspaceMember.count({ where: { workspaceId: ws.body.id, userId: s.outsiderId } }), 0, "opening the link joins nobody");
  assert.equal((await outsider.post(`/api/invite/${token}`, { decision: "accept" })).status, 200);
  assert.equal((await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: ws.body.id, userId: s.outsiderId } } })).role, "viewer");
  assert.equal((await admin.get<{ uses: number }>(`/api/workspaces/${ws.body.id}/invite-link`)).body.uses, 1);
  // Replacing the link kills the old one; turning it off kills it too.
  const fresh = await admin.post<{ url: string }>(`/api/workspaces/${ws.body.id}/invite-link`, { regenerate: true });
  assert.notEqual(fresh.body.url, on.body.url);
  assert.equal((await contributor.get<{ state: string }>(`/api/invite/${token}`)).body.state, "revoked");
  assert.equal((await contributor.post(`/api/invite/${token}`, { decision: "accept" })).status, 400);
  await admin.del(`/api/workspaces/${ws.body.id}/invite-link`);
  assert.equal((await contributor.post(`/api/invite/${fresh.body.url.split("/invite/")[1]}`, { decision: "accept" })).status, 400);
  assert.equal((await contributor.get(`/api/workspaces/${ws.body.id}/invite-link`)).status, 404, "non-members can't manage it");

  // Invite someone with no account: they see it right after signing up with that email.
  const r = await admin.post<{ invitations: { hasAccount: boolean; url: string }[] }>(`/api/workspaces/${ws.body.id}/members`, { email: "newbie@integration.test", role: "editor" });
  assert.equal(r.body.invitations[0].hasAccount, false);
  const newbie = new Client();
  assert.equal((await newbie.post("/api/register", { email: "newbie@integration.test", password: "Newbie1234", name: "Nina New" })).status, 201);
  assert.ok(await newbie.login("newbie@integration.test", "Newbie1234"));
  assert.deepEqual((await newbie.get<unknown[]>("/api/invitations")).body, [], "nothing until the address is verified");
  const nb = await prisma.user.findUniqueOrThrow({ where: { email: "newbie@integration.test" } });
  assert.equal((await admin.patch(`/api/admin/users/${nb.id}`, { verifyEmail: true })).status, 200);
  const mine = await newbie.get<{ workspaceName: string; token: string }[]>("/api/invitations");
  assert.deepEqual(mine.body.map((x) => x.workspaceName), ["Invite Co"]);
  assert.ok((await newbie.get<{ items: { type: string }[] }>("/api/notifications")).body.items.some((n) => n.type === "workspace_invite"), "and in the Action Center");
  // Declining: no membership, the inviter is told, the link is spent.
  assert.equal((await newbie.post<{ joined: boolean }>(`/api/invite/${mine.body[0].token}`, { decision: "decline" })).body.joined, false);
  assert.equal(await prisma.workspaceMember.count({ where: { workspaceId: ws.body.id, user: { email: "newbie@integration.test" } } }), 0);
  assert.equal((await newbie.post(`/api/invite/${mine.body[0].token}`, { decision: "accept" })).status, 400);
  assert.equal((await newbie.get<unknown[]>("/api/invitations")).body.length, 0);

  // Revoking a pending invitation.
  const rv = await admin.post<{ invitations: { invitationId?: string; url: string }[] }>(`/api/workspaces/${ws.body.id}/members`, { email: "viewer@integration.test", role: "viewer" });
  const pending = await admin.get<{ id: string }[]>(`/api/workspaces/${ws.body.id}/invitations`);
  assert.equal(pending.body.length, 1);
  assert.equal((await viewer.del(`/api/invitations/${pending.body[0].id}`)).status, 404, "only the workspace's admins");
  assert.equal((await admin.del(`/api/invitations/${pending.body[0].id}`)).status, 204);
  assert.equal((await viewer.post(`/api/invite/${rv.body.invitations[0].url.split("/invite/")[1]}`, { decision: "accept" })).status, 400);
  assert.ok(!(await viewer.get<{ items: { type: string; actioned: boolean; title: string }[] }>("/api/notifications?view=todo")).body.items.some((n) => n.type === "workspace_invite" && n.title === "Invite Co"), "leaves their To do");
});

test("members can leave; only owners delete a workspace", async () => {
  const invited = await contributor.post<{ invitations: { url: string }[] }>(`/api/workspaces/${s.contributorWs}/members`, { email: "viewer@integration.test", role: "admin" });
  assert.equal(invited.status, 201);
  assert.equal((await viewer.post(`/api/invite/${invited.body.invitations[0].url.split("/invite/")[1]}`, { decision: "accept" })).status, 200);
  assert.equal((await viewer.del(`/api/workspaces/${s.contributorWs}`)).status, 403, "workspace admins can't delete it");
  assert.equal((await viewer.del(`/api/workspaces/${s.contributorWs}/members/${s.viewerId}`)).status, 204, "leave");
  assert.equal((await viewer.get(`/api/workspaces/${s.contributorWs}`)).status, 404);
  // The last owner can't leave.
  assert.equal((await contributor.del(`/api/workspaces/${s.contributorWs}/members/${s.contributorId}`)).status, 400);
  assert.equal((await contributor.del(`/api/workspaces/${s.contributorWs}`)).status, 204);
  assert.ok((await prisma.workspace.findUniqueOrThrow({ where: { id: s.contributorWs } })).deletedAt);
});

test("focus: the session goal is a 25-minute block; the estimate is never touched, only the actual time", async () => {
  const task = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Focus keeps estimate", sys_assignees: [s.contributorId], sys_estimate: 3 } });
  const f = await contributor.post<{ id: string; plannedMinutes: number }>(`/api/tasks/${task.body.id}/focus`, {});
  assert.equal(f.status, 201);
  assert.equal(f.body.plannedMinutes, 25, "not derived from the 3 h estimate");
  await prisma.focusSession.update({ where: { id: f.body.id }, data: { elapsedSeconds: 40 * 60, resumedAt: new Date() } });
  await contributor.patch(`/api/focus/${f.body.id}`, { action: "pause" });
  const row = await prisma.task.findUniqueOrThrow({ where: { id: task.body.id }, select: { estimateMinutes: true, actualMinutes: true } });
  assert.equal(row.estimateMinutes, 180, "estimate unchanged");
  assert.ok((row.actualMinutes ?? 0) >= 40, "focused time went to actual");
  await contributor.patch(`/api/focus/${f.body.id}`, { action: "cancel" });
  await admin.del(`/api/tasks/${task.body.id}`);
});

test("completed time: a built-in column after Progress, set on done, editable, cleared on reopen; done reports missing details", async () => {
  const fields = (await admin.get<{ fields: { id: string; type: string }[] }>(`/api/projects/${s.project}`)).body.fields;
  const ids = fields.map((f) => f.id);
  assert.equal(ids[ids.indexOf("sys_progress") + 1], "sys_completed_at", "right after Progress");
  assert.equal(fields.find((f) => f.id === "sys_completed_at")?.type, "datetime");
  const doneStatus = (await prisma.status.findFirstOrThrow({ where: { workspaceId: s.ws, category: "done" } })).id;
  const todoStatus = (await prisma.status.findFirstOrThrow({ where: { workspaceId: s.ws, category: "todo" } })).id;
  const t = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Finish me" } });
  assert.equal(t.body.data.sys_completed_at, null);
  const done = await admin.patch<Rec & { doneMissing?: string[] }>(`/api/tasks/${t.body.id}`, { data: { sys_status: doneStatus } });
  assert.equal(done.status, 200);
  assert.ok(done.body.data.sys_completed_at, "set automatically");
  assert.deepEqual(done.body.doneMissing, ["sys_actual", "sys_start_date", "sys_due_date"], "what is still empty");
  const again = await admin.patch<Rec & { doneMissing?: string[] }>(`/api/tasks/${t.body.id}`, { data: { sys_actual: 2 } });
  assert.equal(again.body.doneMissing, undefined, "only when the task becomes done");
  const at = "2026-10-01T09:30:00.000Z";
  const edited = await admin.patch<Rec>(`/api/tasks/${t.body.id}`, { data: { sys_completed_at: at } });
  assert.equal(edited.body.data.sys_completed_at, at, "editable");
  assert.equal((await admin.patch(`/api/tasks/${t.body.id}`, { data: { sys_completed_at: new Date(Date.now() + 3 * 86400_000).toISOString() } })).status, 400, "not in the future");
  const reopened = await admin.patch<Rec>(`/api/tasks/${t.body.id}`, { data: { sys_status: todoStatus } });
  assert.equal(reopened.body.data.sys_completed_at, null, "cleared on reopen");
  const explicit = await admin.patch<Rec & { doneMissing?: string[] }>(`/api/tasks/${t.body.id}`, { data: { sys_status: doneStatus, sys_completed_at: at, sys_start_date: "2026-09-28", sys_due_date: "2026-09-30" } });
  assert.equal(explicit.body.data.sys_completed_at, at, "an explicit time in the same save wins over now");
  assert.deepEqual(explicit.body.doneMissing, [], "nothing missing");
  const q = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Quick finish" } });
  const quick = await admin.post<Rec & { doneMissing?: string[] }>(`/api/tasks/${q.body.id}/quick`, { action: "complete" });
  assert.deepEqual(quick.body.doneMissing, ["sys_actual", "sys_start_date", "sys_due_date"]);
  await admin.del(`/api/tasks/${t.body.id}`);
  await admin.del(`/api/tasks/${q.body.id}`);
});

test("ownership: an owner transfers the workspace and steps down; admins hand over what a leaver owns", async () => {
  const roleOf = async (userId: string) => (await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: s.ws, userId } } })).role;
  const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).id;
  const viewerRole = await roleOf(s.viewerId);
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/transfer-ownership`, { toUserId: s.viewerId })).status, 403, "owners only");
  assert.equal((await admin.post(`/api/workspaces/${s.ws}/transfer-ownership`, { toUserId: adminId })).status, 400, "not to yourself");
  const tr = await admin.post(`/api/workspaces/${s.ws}/transfer-ownership`, { toUserId: s.viewerId, myNewRole: "admin" });
  assert.equal(tr.status, 200, JSON.stringify(tr.body));
  assert.equal(await roleOf(s.viewerId), "owner");
  assert.equal(await roleOf(adminId), "admin");
  assert.ok(await prisma.notification.findFirst({ where: { userId: s.viewerId, type: "role_changed", workspaceId: s.ws } }), "the new owner is told");
  // ...and back, restoring the original roles.
  assert.equal((await viewer.post(`/api/workspaces/${s.ws}/transfer-ownership`, { toUserId: adminId, myNewRole: "viewer" })).status, 200);
  assert.equal(await roleOf(adminId), "owner");
  await prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: s.ws, userId: s.viewerId } }, data: { role: viewerRole } });

  // Handover: the contributor owns a project and an objective; the admin moves them to themself.
  const p = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Leaver project" });
  await prisma.project.update({ where: { id: p.body.id }, data: { ownerId: s.contributorId } });
  const counts = await admin.get<{ projects: number; objectives: number; keyResults: number }>(`/api/workspaces/${s.ws}/members/${s.contributorId}/handover`);
  assert.ok(counts.body.projects >= 1);
  assert.equal((await contributor.post(`/api/workspaces/${s.ws}/members/${s.contributorId}/handover`, { toUserId: adminId })).status, 403, "admins only");
  const h = await admin.post<{ projects: number }>(`/api/workspaces/${s.ws}/members/${s.contributorId}/handover`, { toUserId: adminId });
  assert.equal(h.status, 200);
  assert.equal(h.body.projects, counts.body.projects);
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: p.body.id } })).ownerId, adminId);
  assert.equal(await prisma.project.count({ where: { workspaceId: s.ws, ownerId: s.contributorId, deletedAt: null } }), 0);
  await admin.del(`/api/projects/${p.body.id}`);
});

test("AI sees the asker's own not-yet-planned ideas (Put all things on), never other people's", async () => {
  const mine = await contributor.post<{ id: string }>(`/api/workspaces/${s.ws}/thoughts`, { taskName: "Idea only Casey has", projectId: s.project });
  assert.equal(mine.status, 201, JSON.stringify(mine.body));
  const theirs = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/thoughts`, { taskName: "Admin private idea", projectId: s.project });
  assert.equal(theirs.status, 201);
  const r = await action(contributor, { action: "home_plan", targetId: s.ws });
  assert.equal(r.status, 200, r.text);
  const sent = JSON.stringify((await lastModelRequest()).body);
  assert.match(sent, /Idea only Casey has[^"]*NOT PLANNED/, "own idea, flagged as not planned");
  assert.doesNotMatch(sent, /Admin private idea/, "never someone else's ideas");
  await contributor.del(`/api/thoughts/${mine.body.id}`);
  await admin.del(`/api/thoughts/${theirs.body.id}`);
});

test("project permissions: editors don't manage columns/settings unless delegated; members can be narrowed, never beyond their role", async () => {
  const setRole = (userId: string, role: "editor" | "contributor" | "viewer") => prisma.workspaceMember.update({ where: { workspaceId_userId: { workspaceId: s.ws, userId } }, data: { role } });
  const original = (await prisma.workspaceMember.findUniqueOrThrow({ where: { workspaceId_userId: { workspaceId: s.ws, userId: s.contributorId } } })).role;
  try {
    await setRole(s.contributorId, "editor");
    const me = await contributor.get<{ myPermissions: string[] }>(`/api/projects/${s.project}`);
    assert.ok(me.body.myPermissions.includes("task.edit_all"));
    assert.ok(!me.body.myPermissions.includes("fields.manage"), "editors don't manage columns by default");
    assert.equal((await contributor.post(`/api/projects/${s.project}/custom-fields`, { name: "Editor column", type: "text" })).status, 403);
    assert.equal((await contributor.patch(`/api/projects/${s.project}`, { description: "x" })).status, 403, "settings need delegation");
    assert.equal((await contributor.get(`/api/projects/${s.project}/permissions`)).status, 403, "only the owner / admins see the table");

    // The admin delegates columns + settings to the editor.
    const table = await admin.get<{ members: { id: string; permissions: string[]; locked: string | null; ceiling: string[] }[] }>(`/api/projects/${s.project}/permissions`);
    assert.equal(table.status, 200);
    const row = table.body.members.find((m) => m.id === s.contributorId)!;
    assert.equal(row.locked, null);
    assert.equal((await admin.put(`/api/projects/${s.project}/permissions`, { changes: [{ userId: s.contributorId, permissions: [...row.permissions, "fields.manage", "settings.manage"] }] })).status, 200);
    const col = await contributor.post<{ id: string }>(`/api/projects/${s.project}/custom-fields`, { name: "Delegated column", type: "text" });
    assert.equal(col.status, 201, JSON.stringify(col.body));
    assert.equal((await contributor.del(`/api/custom-fields/${col.body.id}`)).status, 204);

    // Narrow: no creating, no comments.
    assert.equal((await admin.put(`/api/projects/${s.project}/permissions`, { changes: [{ userId: s.contributorId, permissions: ["task.edit_own"] }] })).status, 200);
    assert.equal((await contributor.post(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Blocked" } })).status, 403);
    assert.equal((await contributor.post(`/api/tasks/${s.r6task}/comments`, { body: "<p>hi</p>" })).status, 403);
    const other = await admin.post<Rec>(`/api/projects/${s.project}/tasks`, { data: { sys_title: "Someone else's" } });
    assert.equal((await contributor.patch(`/api/tasks/${other.body.id}`, { data: { sys_title: "x" } })).status, 403, "edit own only");

    // Never beyond the workspace role.
    await setRole(s.contributorId, "contributor");
    assert.equal((await admin.put(`/api/projects/${s.project}/permissions`, { changes: [{ userId: s.contributorId, permissions: ["task.edit_all"] }] })).status, 400);
    const capped = await contributor.get<{ myPermissions: string[] }>(`/api/projects/${s.project}`);
    assert.ok(!capped.body.myPermissions.includes("fields.manage"), "a stored grant above the role is ignored");
    assert.equal((await admin.put(`/api/projects/${s.project}/permissions`, { changes: [{ userId: s.contributorId, permissions: null }] })).status, 200, "back to defaults");
    assert.ok((await contributor.get<{ myPermissions: string[] }>(`/api/projects/${s.project}`)).body.myPermissions.includes("task.create"));
    assert.equal((await admin.put(`/api/projects/${s.project}/permissions`, { changes: [{ userId: (await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } })).id, permissions: [] }] })).status, 400, "owners/admins always full");
    await admin.del(`/api/tasks/${other.body.id}`);
  } finally {
    await prisma.projectMemberPermission.deleteMany({ where: { projectId: s.project } });
    await setRole(s.contributorId, original as "contributor");
  }
});

test("project transfer: everything of a project moves into another one (tasks, sub-tasks, comments, columns, categories, objectives)", async () => {
  const A = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Transfer source" })).body.id;
  const B = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Transfer target" })).body.id;
  const catA = (await admin.post<{ id: string }>(`/api/projects/${A}/categories`, { name: "Hồ sơ", color: "#ff0000" })).body.id;
  const typeA = await admin.post<{ id: string }>(`/api/projects/${A}/custom-fields`, { name: "Loại", type: "single_select", config: { options: [{ label: "Chính thức", color: "#00ff00" }, { label: "Thử việc", color: "#0000ff" }] } });
  const noteA = await admin.post<{ id: string }>(`/api/projects/${A}/custom-fields`, { name: "Ghi chú HR", type: "text" });
  const typeB = await admin.post<{ id: string }>(`/api/projects/${B}/custom-fields`, { name: "loại", type: "single_select", config: { options: [{ label: "Thử việc", color: "#999999" }] } });
  const optA = (await prisma.customFieldOption.findFirstOrThrow({ where: { customFieldId: typeA.body.id, label: "Thử việc" } })).id;
  const parent = await admin.post<Rec>(`/api/projects/${A}/tasks`, { data: { sys_title: "Parent", sys_category: catA, [typeA.body.id]: optA, [noteA.body.id]: "giữ nguyên" } });
  const child = await admin.post<Rec>(`/api/projects/${A}/tasks`, { data: { sys_title: "Child", sys_parent: [parent.body.id] } });
  await admin.post(`/api/tasks/${parent.body.id}/comments`, { body: "<p>Đã nhận hồ sơ</p>" });
  const obj = await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/objectives`, { title: "Source objective", projectId: A, cycleType: "quarter" });
  assert.equal(obj.status, 201, JSON.stringify(obj.body));

  assert.equal((await contributor.get(`/api/projects/${A}/transfer?targetProjectId=${B}`)).status, 403, "project owners / admins only");
  const plan = await admin.get<{ tasks: number; comments: number; fields: { name: string; action: string }[]; categories: { action: string }[] }>(`/api/projects/${A}/transfer?targetProjectId=${B}`);
  assert.equal(plan.status, 200);
  assert.equal(plan.body.tasks, 2);
  assert.equal(plan.body.comments, 1);
  assert.equal(plan.body.fields.find((f) => f.name === "Loại")?.action, "reuse", "same name + type, any case");
  assert.equal(plan.body.fields.find((f) => f.name === "Ghi chú HR")?.action, "create");

  const r = await admin.post<{ tasks: number }>(`/api/projects/${A}/transfer`, { targetProjectId: B });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.tasks, 2);
  const p2 = await prisma.task.findUniqueOrThrow({ where: { id: parent.body.id }, include: { category: true, customValues: true, comments: true } });
  assert.equal(p2.projectId, B);
  assert.equal(p2.category?.projectId, B, "category recreated in the target");
  assert.equal(p2.category?.name, "Hồ sơ");
  assert.equal(p2.comments.length, 1, "comments travel with the task");
  const typeVal = p2.customValues.find((v) => v.customFieldId === typeB.body.id);
  assert.ok(typeVal, "value moved onto the matching target column");
  const opt = await prisma.customFieldOption.findUniqueOrThrow({ where: { id: typeVal!.valueOptionId! } });
  assert.equal(opt.customFieldId, typeB.body.id);
  assert.equal(opt.label, "Thử việc", "option matched by label");
  const note = p2.customValues.find((v) => v.valueText === "giữ nguyên");
  assert.ok(note && (await prisma.customField.findUniqueOrThrow({ where: { id: note.customFieldId } })).projectId === B, "new column created in the target");
  assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: child.body.id } })).parentTaskId, parent.body.id, "sub-task keeps its parent");
  assert.equal((await prisma.objective.findUniqueOrThrow({ where: { id: obj.body.id } })).projectId, B);
  assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: A } })).status, "archived");
  assert.equal(await prisma.task.count({ where: { projectId: A } }), 0);
  const grid = await admin.get<{ records: Rec[] } | Rec[]>(`/api/projects/${B}/tasks`);
  assert.equal(grid.status, 200, "target grid loads");
  await admin.del(`/api/projects/${A}`);
  await admin.del(`/api/projects/${B}`);
});

test("task transfer: move or duplicate selected tasks with sub-tasks, comments, columns, categories and permissions", async () => {
  const A = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Task move source" })).body.id;
  const B = (await admin.post<{ id: string }>(`/api/workspaces/${s.ws}/projects`, { name: "Task move target" })).body.id;
  try {
    const catA = (await admin.post<{ id: string }>(`/api/projects/${A}/categories`, { name: "Hồ sơ", color: "#ff0000" })).body.id;
    const catOnlyA = (await admin.post<{ id: string }>(`/api/projects/${A}/categories`, { name: "Riêng A", color: "#00ff00" })).body.id;
    const catB = (await admin.post<{ id: string }>(`/api/projects/${B}/categories`, { name: "hồ sơ", color: "#0000ff" })).body.id;
    const typeA = (await admin.post<{ id: string }>(`/api/projects/${A}/custom-fields`, { name: "Loại", type: "single_select", config: { options: [{ label: "Chính thức", color: "#00ff00" }, { label: "Thử việc", color: "#0000ff" }] } })).body.id;
    const typeB = (await admin.post<{ id: string }>(`/api/projects/${B}/custom-fields`, { name: "loại", type: "single_select", config: { options: [{ label: "Thử việc", color: "#999999" }] } })).body.id;
    const noteA = (await admin.post<{ id: string }>(`/api/projects/${A}/custom-fields`, { name: "Ghi chú HR", type: "text" })).body.id;
    const linkA = await admin.post<{ id: string }>(`/api/projects/${A}/custom-fields`, { name: "Liên quan", type: "link" });
    assert.equal(linkA.status, 201, JSON.stringify(linkA.body));
    const optA = (await prisma.customFieldOption.findFirstOrThrow({ where: { customFieldId: typeA, label: "Thử việc" } })).id;

    const R = (await admin.post<Rec>(`/api/projects/${A}/tasks`, { data: { sys_title: "R stays" } })).body.id;
    const P = (await admin.post<Rec>(`/api/projects/${A}/tasks`, { data: { sys_title: "P", sys_category: catA, [typeA]: optA, [noteA]: "giữ nguyên", [linkA.body.id]: [R] } })).body.id;
    const C = (await admin.post<Rec>(`/api/projects/${A}/tasks`, { data: { sys_title: "C child", sys_parent: [P] } })).body.id;
    const Q = (await admin.post<Rec>(`/api/projects/${A}/tasks`, { data: { sys_title: "Q", sys_category: catOnlyA, sys_depends_on: [R] } })).body.id;
    const c1 = await admin.post<{ id: string }>(`/api/tasks/${P}/comments`, { body: "<p>Đã nhận hồ sơ</p>" });
    assert.equal(c1.status, 201, JSON.stringify(c1.body));
    await prisma.comment.create({ data: { taskId: P, authorId: s.contributorId, parentCommentId: c1.body.id, body: "<p>Ok</p>" } });
    await prisma.attachment.create({ data: { workspaceId: s.ws, taskId: P, fileName: "cv.pdf", contentType: "application/pdf", sizeBytes: 10, storageKey: `it/${P}/cv.pdf`, url: "https://blob.invalid/cv.pdf" } });
    const body = (mode: "move" | "duplicate", taskIds: string[], extra: object = {}) => ({ sourceProjectId: A, targetProjectId: B, taskIds, mode, ...extra });

    // Permissions: outsiders see nothing; a contributor can't move a task they neither created nor are assigned to.
    assert.equal((await outsider.post("/api/tasks/transfer", body("duplicate", [P]))).status, 404);
    assert.equal((await contributor.post("/api/tasks/transfer", body("move", [P]))).status, 403, "contributors move only their own tasks");
    assert.equal((await admin.post("/api/tasks/transfer", { ...body("move", [P]), targetProjectId: A })).status, 400, "move needs another project");
    assert.equal((await admin.post("/api/tasks/transfer", body("move", [C, "00000000-0000-4000-8000-000000000000"]))).status, 400, "tasks of another project are refused");

    // Preview.
    type Plan = { tasks: number; subtasks: number; comments: number; files: number; filesAvailable: boolean; droppedLinks: number; fields: { name: string; action: string }[]; categories: { name: string; action: string }[] };
    const plan = await admin.post<Plan>("/api/tasks/transfer", body("duplicate", [P, Q], { dryRun: true }));
    assert.equal(plan.status, 200, JSON.stringify(plan.body));
    assert.equal(plan.body.tasks, 2);
    assert.equal(plan.body.subtasks, 1, "sub-tasks come along");
    assert.equal(plan.body.comments, 2);
    assert.equal(plan.body.files, 1);
    assert.equal(plan.body.filesAvailable, false, "no file storage in tests");
    assert.equal(plan.body.droppedLinks, 1, "a link to a task that stays behind is reported");
    assert.equal(plan.body.fields.find((f) => f.name === "Loại")?.action, "reuse");
    assert.equal(plan.body.fields.find((f) => f.name === "Ghi chú HR")?.action, "create");
    assert.equal(plan.body.categories.find((c) => c.name === "Hồ sơ")?.action, "reuse");
    assert.equal(plan.body.categories.find((c) => c.name === "Riêng A")?.action, "create");
    assert.equal(await prisma.task.count({ where: { projectId: B } }), 0, "a preview writes nothing");

    // Duplicate into B.
    const d = await admin.post<{ tasks: number; subtasks: number; comments: number; files: number; filesFailed: number; taskIds: string[] }>("/api/tasks/transfer", body("duplicate", [P, Q]));
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.deepEqual([d.body.tasks, d.body.subtasks, d.body.comments, d.body.files, d.body.filesFailed], [2, 1, 2, 0, 1]);
    const copies = await prisma.task.findMany({ where: { projectId: B }, include: { category: true, customValues: true, comments: { orderBy: { createdAt: "asc" } }, dependencies: true } });
    assert.equal(copies.length, 3);
    const P2 = copies.find((t) => t.title === "P")!;
    const C2 = copies.find((t) => t.title === "C child")!;
    const Q2 = copies.find((t) => t.title === "Q")!;
    assert.equal(P2.categoryId, catB, "category matched by name in the target");
    assert.equal(Q2.category?.name, "Riêng A", "missing category created in the target");
    assert.equal(Q2.category?.projectId, B);
    const typeVal = P2.customValues.find((v) => v.customFieldId === typeB);
    assert.equal((await prisma.customFieldOption.findUniqueOrThrow({ where: { id: typeVal!.valueOptionId! } })).label, "Thử việc");
    assert.ok(P2.customValues.some((v) => v.valueText === "giữ nguyên"), "value lands in a column created in the target");
    assert.ok(P2.customValues.every((v) => v.valueTaskIds.length === 0), "links to tasks left behind are dropped");
    assert.equal(C2.parentTaskId, P2.id, "sub-task copied under the copy");
    assert.equal(P2.comments.length, 2);
    assert.equal(P2.comments[0].body, "<p>Đã nhận hồ sơ</p>");
    assert.equal(P2.comments[1].authorId, s.contributorId, "comment authors are kept");
    assert.equal(P2.comments[1].parentCommentId, P2.comments[0].id, "replies stay in their thread");
    assert.deepEqual(Q2.dependencies.map((x) => x.dependsOnTaskId), [R], "dependency on a task outside the copy is kept (same workspace)");
    assert.equal(await prisma.attachment.count({ where: { taskId: P2.id } }), 0, "without file storage no file is copied (and none is shared)");
    assert.ok(await prisma.activityLog.findFirst({ where: { entityId: P2.id, summary: { contains: "Duplicated from" } } }), "history says where the copy came from");
    assert.equal(await prisma.task.count({ where: { projectId: A, deletedAt: null } }), 4, "originals untouched");
    assert.equal(await prisma.comment.count({ where: { taskId: P } }), 2);

    // Duplicate inside the same project keeps its categories and links.
    const same = await admin.post<{ taskIds: string[] }>("/api/tasks/transfer", { ...body("duplicate", [Q]), targetProjectId: A });
    assert.equal(same.status, 200, JSON.stringify(same.body));
    assert.equal((await prisma.task.findUniqueOrThrow({ where: { id: same.body.taskIds[0] } })).categoryId, catOnlyA);

    // Move P (and its sub-task) into B: same task ids, comments and files stay attached.
    const m = await admin.post<{ tasks: number; subtasks: number }>("/api/tasks/transfer", body("move", [P]));
    assert.equal(m.status, 200, JSON.stringify(m.body));
    assert.deepEqual([m.body.tasks, m.body.subtasks], [1, 1]);
    const P3 = await prisma.task.findUniqueOrThrow({ where: { id: P }, include: { customValues: true } });
    assert.equal(P3.projectId, B);
    assert.equal(P3.categoryId, catB);
    assert.ok(P3.customValues.some((v) => v.customFieldId === typeB), "value moved onto the matching column");
    assert.ok(P3.customValues.every((v) => v.valueTaskIds.length === 0), "link to a task that stayed behind removed");
    const C3 = await prisma.task.findUniqueOrThrow({ where: { id: C } });
    assert.equal(C3.projectId, B);
    assert.equal(C3.parentTaskId, P, "sub-task keeps its parent");
    assert.equal(await prisma.comment.count({ where: { taskId: P } }), 2, "comments stay on the moved task");
    assert.equal(await prisma.attachment.count({ where: { taskId: P } }), 1, "files stay on the moved task");

    // A selected sub-task whose parent stays behind becomes a top-level task.
    const S = (await admin.post<Rec>(`/api/projects/${A}/tasks`, { data: { sys_title: "S", sys_parent: [Q] } })).body.id;
    assert.equal((await admin.post("/api/tasks/transfer", body("move", [S]))).status, 200);
    const S2 = await prisma.task.findUniqueOrThrow({ where: { id: S } });
    assert.deepEqual([S2.projectId, S2.parentTaskId], [B, null]);

    // Contributors move their own tasks.
    const own = (await contributor.post<Rec>(`/api/projects/${A}/tasks`, { data: { sys_title: "Mine" } })).body.id;
    assert.equal((await contributor.post("/api/tasks/transfer", body("move", [own]))).status, 200);

    assert.equal((await admin.get(`/api/projects/${A}/tasks`)).status, 200);
    assert.equal((await admin.get(`/api/projects/${B}/tasks`)).status, 200);
  } finally {
    // The fake file row (no object storage in tests) must not outlive this test.
    await prisma.attachment.deleteMany({ where: { storageKey: { startsWith: "it/" } } });
    await admin.del(`/api/projects/${A}`);
    await admin.del(`/api/projects/${B}`);
  }
});
