import { test } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import type { WorkspaceRole } from "@prisma/client";
import { Client } from "../client";
import { prisma } from "./context";

// Every workspace role (plus someone outside the workspace) against the same actions,
// on a project they can see and on one hidden from them. One fresh workspace, so the
// table doesn't depend on what earlier chapters changed. Members are added straight
// to the database: this chapter checks what the API allows, not the invitation flow.

type Who = "owner" | "admin" | "editor" | "contributor" | "viewer" | "outsider";
type Action = "read project" | "read task" | "create task" | "edit someone's task" | "edit own task" | "comment" | "delete someone's task" | "change visibility";

// Expected HTTP outcome: "ok" = 2xx, "forbidden" = 403, "hidden" = 404 (the API doesn't reveal it exists).
const VISIBLE: Record<Who, Record<Action, "ok" | "forbidden" | "hidden">> = {
  owner: { "read project": "ok", "read task": "ok", "create task": "ok", "edit someone's task": "ok", "edit own task": "ok", comment: "ok", "delete someone's task": "ok", "change visibility": "ok" },
  // Workspace admins hold every project right, but running the project (visibility) belongs to its active owner.
  admin: { "read project": "ok", "read task": "ok", "create task": "ok", "edit someone's task": "ok", "edit own task": "ok", comment: "ok", "delete someone's task": "ok", "change visibility": "forbidden" },
  editor: { "read project": "ok", "read task": "ok", "create task": "ok", "edit someone's task": "ok", "edit own task": "ok", comment: "ok", "delete someone's task": "ok", "change visibility": "forbidden" },
  contributor: { "read project": "ok", "read task": "ok", "create task": "ok", "edit someone's task": "forbidden", "edit own task": "ok", comment: "ok", "delete someone's task": "forbidden", "change visibility": "forbidden" },
  viewer: { "read project": "ok", "read task": "ok", "create task": "forbidden", "edit someone's task": "forbidden", "edit own task": "forbidden", comment: "ok", "delete someone's task": "forbidden", "change visibility": "forbidden" },
  outsider: { "read project": "hidden", "read task": "hidden", "create task": "hidden", "edit someone's task": "hidden", "edit own task": "hidden", comment: "hidden", "delete someone's task": "hidden", "change visibility": "hidden" },
};
const HIDEABLE: Who[] = ["editor", "contributor", "viewer"];

const ROLE: Record<Exclude<Who, "outsider">, WorkspaceRole> = { owner: "owner", admin: "admin", editor: "editor", contributor: "contributor", viewer: "viewer" };
const PASSWORD = "Matrix1234";

const outcome = (status: number) => (status >= 200 && status < 300 ? "ok" : status === 403 ? "forbidden" : status === 404 ? "hidden" : `status ${status}`);

test("permission matrix: every role x action on a visible project and on one hidden from them", async () => {
  const stamp = Date.now();
  const users = {} as Record<Who, { id: string; client: Client }>;
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  for (const who of Object.keys(VISIBLE) as Who[]) {
    const email = `matrix.${who}.${stamp}@integration.test`;
    const row = await prisma.user.create({ data: { email, name: `Matrix ${who}`, passwordHash, mustChangePassword: false, emailVerifiedAt: new Date() } });
    const client = new Client();
    assert.ok(await client.login(email, PASSWORD), `${who} signs in`);
    users[who] = { id: row.id, client };
  }
  const owner = users.owner.client;
  const ws = await owner.post<{ id: string }>("/api/workspaces", { name: `Matrix ${stamp}` });
  assert.equal(ws.status, 201);
  for (const who of ["admin", "editor", "contributor", "viewer"] as const) await prisma.workspaceMember.create({ data: { workspaceId: ws.body.id, userId: users[who].id, role: ROLE[who] } });

  const project = async (name: string) => {
    const p = await owner.post<{ id: string }>(`/api/workspaces/${ws.body.id}/projects`, { name });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    return p.body.id;
  };
  const visible = await project("Visible to everyone");
  const hidden = await project("Hidden from some");
  assert.equal((await owner.put(`/api/projects/${hidden}/visibility`, { hiddenUserIds: HIDEABLE.map((w) => users[w].id) })).status, 200);

  const failures: string[] = [];
  for (const [projectId, label] of [
    [visible, "visible"],
    [hidden, "hidden"],
  ] as const) {
    for (const who of Object.keys(VISIBLE) as Who[]) {
      const c = users[who].client;
      // Fresh targets per caller, so one caller's delete doesn't change the next row.
      const someone = await owner.post<{ id: string }>(`/api/projects/${projectId}/tasks`, { data: { sys_title: `Owner's task for ${who}` } });
      assert.equal(someone.status, 201);
      // "Own" = assigned to the caller (created by the owner, so viewers and outsiders have one too).
      const own = await owner.post<{ id: string }>(`/api/projects/${projectId}/tasks`, { data: { sys_title: `${who}'s own task`, ...(who === "outsider" ? {} : { sys_assignees: [users[who].id] }) } });
      assert.equal(own.status, 201, JSON.stringify(own.body));
      const actual: Record<Action, number> = {
        "read project": (await c.get(`/api/projects/${projectId}`)).status,
        "read task": (await c.get(`/api/tasks/${someone.body.id}`)).status,
        "create task": (await c.post(`/api/projects/${projectId}/tasks`, { data: { sys_title: `Created by ${who}` } })).status,
        "edit someone's task": (await c.patch(`/api/tasks/${someone.body.id}`, { data: { sys_title: `Edited by ${who}` } })).status,
        "edit own task": (await c.patch(`/api/tasks/${own.body.id}`, { data: { sys_title: `Own task edited by ${who}` } })).status,
        comment: (await c.post(`/api/tasks/${someone.body.id}/comments`, { body: `Comment from ${who}` })).status,
        "delete someone's task": (await c.del(`/api/tasks/${someone.body.id}`)).status,
        "change visibility": (await c.put(`/api/projects/${projectId}/visibility`, { hiddenUserIds: label === "hidden" ? HIDEABLE.map((w) => users[w].id) : [] })).status,
      };
      for (const action of Object.keys(actual) as Action[]) {
        const expected = label === "hidden" && HIDEABLE.includes(who) ? "hidden" : VISIBLE[who][action];
        if (outcome(actual[action]) !== expected) failures.push(`${label} project, ${who}, ${action}: expected ${expected}, got ${actual[action]}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});
