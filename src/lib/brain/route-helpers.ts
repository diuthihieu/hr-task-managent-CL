import "server-only";
import { prisma } from "../prisma";
import { requireUser, requireWorkspaceRole } from "../authz";
import { brainAccess } from "./access";

/** Common preamble of workspace-level brain routes: caller, access filters and the workspace base path. */
export async function brainContext(workspaceId: string) {
  const user = await requireUser();
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  const [access, ws] = await Promise.all([brainAccess(user, workspaceId, ctx.role), prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true, name: true } })]);
  return { user, ctx, access, base: `/w/${ws.slug}`, workspaceName: ws.name };
}
