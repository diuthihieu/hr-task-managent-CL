// Client-safe: the capabilities a member can have inside one project, the
// defaults of each workspace role and the ceiling a role can never exceed.
// Enforced by src/lib/project-permissions.ts on the server.

export const PROJECT_CAPS = [
  "task.create",
  "task.edit_own",
  "task.edit_all",
  "task.delete",
  "task.comment",
  "fields.manage",
  "views.create",
  "views.manage",
  "okr.manage",
  "settings.manage",
] as const;
export type ProjectCap = (typeof PROJECT_CAPS)[number];

type Role = "owner" | "admin" | "editor" | "contributor" | "viewer";

/** What a role gets in a project unless the project owner changes it. */
export const DEFAULT_CAPS: Record<Role, ProjectCap[]> = {
  owner: [...PROJECT_CAPS],
  admin: [...PROJECT_CAPS],
  // Adding/editing columns and project settings are delegated explicitly.
  editor: ["task.create", "task.edit_own", "task.edit_all", "task.delete", "task.comment", "views.create", "views.manage", "okr.manage"],
  contributor: ["task.create", "task.edit_own", "task.delete", "task.comment", "views.create"],
  viewer: ["task.comment", "views.create"],
};

/** Project rights can only narrow the workspace role, never go beyond it. */
export const CEILING_CAPS: Record<Role, ProjectCap[]> = {
  owner: [...PROJECT_CAPS],
  admin: [...PROJECT_CAPS],
  editor: [...PROJECT_CAPS],
  contributor: ["task.create", "task.edit_own", "task.delete", "task.comment", "views.create"],
  viewer: ["task.comment", "views.create"],
};

/** Effective caps: full for workspace owners/admins, the role ceiling for the project owner, else stored-or-default capped by the role. */
export function effectiveCaps(role: Role, isProjectOwner: boolean, stored: string[] | null | undefined): ProjectCap[] {
  if (role === "owner" || role === "admin") return [...PROJECT_CAPS];
  // The project owner gets everything their workspace role allows (all of it for an editor).
  if (isProjectOwner) return [...CEILING_CAPS[role]];
  const ceiling = new Set<string>(CEILING_CAPS[role]);
  const wanted = stored ?? DEFAULT_CAPS[role];
  return PROJECT_CAPS.filter((c) => ceiling.has(c) && wanted.includes(c));
}
