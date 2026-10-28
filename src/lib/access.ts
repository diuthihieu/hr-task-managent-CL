// The access model's plain building blocks: who the caller is, how workspace and
// wiki roles rank, and the request context a permission check works on. No
// database or auth here, so the permission modules (authz.ts,
// project-permissions.ts) can share it without importing each other in a loop.
import type { SystemRole, WorkspaceRole } from "@prisma/client";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  systemRole: SystemRole;
  mustChangePassword: boolean;
  avatarColor: string;
  locale: string;
  emailVerifiedAt: Date | null;
}

/** Break-glass support mode: system admins act as owners everywhere while ADMIN_SUPPORT_ACCESS=1. */
export function supportAccess(user: Pick<SessionUser, "systemRole">): boolean {
  return user.systemRole === "ADMIN" && process.env.ADMIN_SUPPORT_ACCESS === "1";
}

const ROLE_RANK: Record<WorkspaceRole, number> = { viewer: 0, contributor: 1, editor: 2, admin: 3, owner: 4 };

export function roleAtLeast(role: WorkspaceRole | null | undefined, min: WorkspaceRole): boolean {
  if (!role) return false;
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export interface WorkspaceContext {
  user: SessionUser;
  workspaceId: string;
  role: WorkspaceRole;
  /** Set when the request targets something that lives inside a project. */
  projectId?: string;
  /** Set when the request targets something inside a wiki; `wikiRole` is the caller's role there. */
  wikiId?: string;
  wikiRole?: WikiRoleName;
}

export type WikiRoleName = "viewer" | "editor" | "manager";
const WIKI_RANK: Record<WikiRoleName, number> = { viewer: 0, editor: 1, manager: 2 };
export const wikiRoleAtLeast = (r: WikiRoleName | null | undefined, min: WikiRoleName) => !!r && WIKI_RANK[r] >= WIKI_RANK[min];
