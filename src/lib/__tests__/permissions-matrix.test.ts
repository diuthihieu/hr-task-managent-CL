// The permission rules written out as tables: a change to any role's rights has
// to change this file too, so it can't happen by accident in a refactor.
import assert from "node:assert/strict";
import test from "node:test";
import { roleAtLeast, supportAccess, wikiRoleAtLeast } from "../access";
import { effectiveCaps, PROJECT_CAPS, type ProjectCap } from "../project-caps";
import { canDeleteView } from "../view-permissions";

const ROLES = ["viewer", "contributor", "editor", "admin", "owner"] as const;
type Role = (typeof ROLES)[number];

test("workspace roles rank viewer < contributor < editor < admin < owner", () => {
  for (const [i, role] of ROLES.entries())
    for (const [j, min] of ROLES.entries()) assert.equal(roleAtLeast(role, min), i >= j, `${role} at least ${min}`);
  for (const min of ROLES) {
    assert.equal(roleAtLeast(null, min), false, "no membership never passes");
    assert.equal(roleAtLeast(undefined, min), false);
  }
});

test("wiki roles rank viewer < editor < manager", () => {
  const wiki = ["viewer", "editor", "manager"] as const;
  for (const [i, role] of wiki.entries()) for (const [j, min] of wiki.entries()) assert.equal(wikiRoleAtLeast(role, min), i >= j, `${role} at least ${min}`);
  assert.equal(wikiRoleAtLeast(null, "viewer"), false);
});

test("support access needs a system admin AND the server switch", () => {
  const before = process.env.ADMIN_SUPPORT_ACCESS;
  try {
    delete process.env.ADMIN_SUPPORT_ACCESS;
    assert.equal(supportAccess({ systemRole: "ADMIN" }), false, "switch off");
    process.env.ADMIN_SUPPORT_ACCESS = "1";
    assert.equal(supportAccess({ systemRole: "ADMIN" }), true);
    assert.equal(supportAccess({ systemRole: "MEMBER" }), false, "members never, even with the switch on");
    process.env.ADMIN_SUPPORT_ACCESS = "true";
    assert.equal(supportAccess({ systemRole: "ADMIN" }), false, "only the exact value 1");
  } finally {
    if (before === undefined) delete process.env.ADMIN_SUPPORT_ACCESS;
    else process.env.ADMIN_SUPPORT_ACCESS = before;
  }
});

// Default rights of each workspace role inside a project nobody customised.
const DEFAULTS: Record<Role, ProjectCap[]> = {
  viewer: ["task.comment", "views.create"],
  contributor: ["task.create", "task.edit_own", "task.delete", "task.comment", "views.create"],
  editor: ["task.create", "task.edit_own", "task.edit_all", "task.delete", "task.comment", "views.create", "views.manage", "okr.manage"],
  admin: [...PROJECT_CAPS],
  owner: [...PROJECT_CAPS],
};
// What the project owner holds in their own project, by their workspace role.
const AS_PROJECT_OWNER: Record<Role, ProjectCap[]> = {
  viewer: ["task.comment", "views.create"],
  contributor: ["task.create", "task.edit_own", "task.delete", "task.comment", "views.create"],
  editor: [...PROJECT_CAPS],
  admin: [...PROJECT_CAPS],
  owner: [...PROJECT_CAPS],
};

test("project rights: role defaults and the project owner's rights", () => {
  for (const role of ROLES) {
    assert.deepEqual(effectiveCaps(role, false, null), DEFAULTS[role], `${role} default`);
    assert.deepEqual(effectiveCaps(role, true, null), AS_PROJECT_OWNER[role], `${role} as project owner`);
    assert.deepEqual(effectiveCaps(role, true, []), AS_PROJECT_OWNER[role], `${role} as project owner ignores a stored narrowing`);
  }
});

test("project rights only narrow a workspace role, never widen it", () => {
  for (const role of ROLES) {
    // Asking for everything gives at most what the role can ever have.
    const all = effectiveCaps(role, false, [...PROJECT_CAPS]);
    assert.deepEqual(all, AS_PROJECT_OWNER[role], `${role} can't be raised past its ceiling`);
    // An empty list takes everything away - workspace owners and admins included.
    assert.deepEqual(effectiveCaps(role, false, []), [], `${role} can be narrowed to nothing`);
    // Unknown capability names are dropped.
    assert.deepEqual(effectiveCaps(role, false, ["admin.everything", "task.comment"]), ["task.comment"]);
  }
  assert.ok(!effectiveCaps("viewer", false, ["task.edit_all", "settings.manage"]).length, "a viewer never edits");
  assert.ok(!effectiveCaps("contributor", false, ["task.edit_all", "fields.manage", "settings.manage"]).length, "a contributor never edits others' tasks or runs the project");
});

test("deleting views follows the project's rights", () => {
  const base = { userId: "u1", viewCreatedById: "u1", isBase: false };
  const cases: [string, Parameters<typeof canDeleteView>[0], boolean][] = [
    ["base view: project manager", { ...base, isBase: true, isProjectManager: true, canManageViews: false, canCreateViews: false }, true],
    ["base view: shared-view editor is not enough", { ...base, isBase: true, isProjectManager: false, canManageViews: true, canCreateViews: true }, false],
    ["shared view: project manager", { ...base, viewCreatedById: "u2", isProjectManager: true, canManageViews: false, canCreateViews: false }, true],
    ["shared view: may edit shared views", { ...base, viewCreatedById: "u2", isProjectManager: false, canManageViews: true, canCreateViews: false }, true],
    ["own view while still allowed to add views", { ...base, isProjectManager: false, canManageViews: false, canCreateViews: true }, true],
    ["own view after losing 'add views'", { ...base, isProjectManager: false, canManageViews: false, canCreateViews: false }, false],
    ["someone else's view with only 'add views'", { ...base, viewCreatedById: "u2", isProjectManager: false, canManageViews: false, canCreateViews: true }, false],
    ["view without a creator with only 'add views'", { ...base, viewCreatedById: null, isProjectManager: false, canManageViews: false, canCreateViews: true }, false],
  ];
  for (const [name, input, expected] of cases) assert.equal(canDeleteView(input), expected, name);
});
