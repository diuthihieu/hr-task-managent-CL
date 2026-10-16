import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, assertCanManageProject, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { uuid } from "@/lib/validation";
import { PROJECT_CAPS, CEILING_CAPS, DEFAULT_CAPS, effectiveCaps, type ProjectCap } from "@/lib/project-caps";

type P = { projectId: string };

/**
 * The project's permission table: every workspace member with their workspace
 * role, whether the project is hidden from them, their effective rights here,
 * what their role allows at most, and whether they are locked to full rights
 * (workspace owners/admins and the project owner/creator).
 * Only the project owner/creator and workspace admins can read or change it.
 */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "editor");
  await assertCanManageProject(ctx, projectId);
  const [project, members, hidden, rows] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { ownerId: true, createdById: true } }),
    prisma.workspaceMember.findMany({ where: { workspaceId: ctx.workspaceId, user: { deletedAt: null } }, include: { user: { select: { id: true, name: true, email: true, avatarColor: true, isActive: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.projectHiddenMember.findMany({ where: { projectId }, select: { userId: true } }),
    prisma.projectMemberPermission.findMany({ where: { projectId }, select: { userId: true, permissions: true } }),
  ]);
  const hiddenIds = new Set(hidden.map((h) => h.userId));
  const stored = new Map(rows.map((r) => [r.userId, r.permissions]));
  return NextResponse.json({
    capabilities: PROJECT_CAPS,
    defaults: DEFAULT_CAPS,
    ceilings: CEILING_CAPS,
    members: members.map((m) => {
      const isOwner = m.userId === project.ownerId || m.userId === project.createdById;
      const locked = m.role === "owner" || m.role === "admin" ? "admin" : isOwner && m.role === "editor" ? "project_owner" : null;
      return {
        ...m.user,
        role: m.role,
        hidden: hiddenIds.has(m.userId),
        locked,
        custom: stored.has(m.userId),
        permissions: effectiveCaps(m.role, isOwner, stored.get(m.userId) ?? null),
        ceiling: CEILING_CAPS[m.role],
      };
    }),
  });
});

const schema = z.object({
  userId: uuid,
  /** null = back to the defaults of their workspace role. */
  permissions: z.array(z.enum(PROJECT_CAPS)).max(PROJECT_CAPS.length).nullable(),
});

/** Set one member's rights in this project (capped by their workspace role). */
export const PUT = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "editor");
  await assertCanManageProject(ctx, projectId);
  const body = schema.parse(await readJson(req));
  const [project, member] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { ownerId: true, createdById: true } }),
    prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId: body.userId } }, select: { role: true } }),
  ]);
  if (!member) throw badRequest("Only workspace members have rights in a project");
  if (member.role === "owner" || member.role === "admin") throw badRequest("Workspace owners and admins always have full rights in every project");
  const isOwner = body.userId === project.ownerId || body.userId === project.createdById;
  if (isOwner && member.role === "editor") throw badRequest("The project owner and creator always have full rights");
  const ceiling = new Set<ProjectCap>(CEILING_CAPS[member.role]);
  const beyond = (body.permissions ?? []).filter((c) => !ceiling.has(c));
  if (beyond.length) throw badRequest(`A ${member.role} can't be given: ${beyond.join(", ")} - change their workspace role first`);
  const before = await prisma.projectMemberPermission.findUnique({ where: { projectId_userId: { projectId, userId: body.userId } }, select: { permissions: true } });
  await prisma.$transaction(async (tx) => {
    if (body.permissions === null) await tx.projectMemberPermission.deleteMany({ where: { projectId, userId: body.userId } });
    else
      await tx.projectMemberPermission.upsert({
        where: { projectId_userId: { projectId, userId: body.userId } },
        create: { projectId, userId: body.userId, permissions: [...new Set(body.permissions)], updatedById: user.id },
        update: { permissions: [...new Set(body.permissions)], updatedById: user.id },
      });
    await logActivity(tx, {
      workspaceId: ctx.workspaceId,
      actorId: user.id,
      entityType: "project",
      entityId: projectId,
      action: "updated",
      summary: body.permissions === null ? "Reset a member's project rights to the defaults" : "Changed a member's project rights",
      changes: { [`permissions:${body.userId}`]: { from: before?.permissions ?? "default", to: body.permissions ?? "default" } },
    });
  });
  return NextResponse.json({ userId: body.userId, permissions: effectiveCaps(member.role, isOwner, body.permissions) });
});
