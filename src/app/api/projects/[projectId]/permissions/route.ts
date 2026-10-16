import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, assertCanManageProject, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { uuid } from "@/lib/validation";
import { projectOwner } from "@/lib/project-permissions";
import { PROJECT_CAPS, CEILING_CAPS, DEFAULT_CAPS, effectiveCaps, type ProjectCap } from "@/lib/project-caps";

type P = { projectId: string };

/**
 * The project's permission table: every workspace member with their workspace
 * role, whether they can see the project, their rights here and the most their
 * role allows. Only the project owner is locked (always full rights); the
 * project owner can narrow or widen everyone else - workspace owners/admins too.
 * Readable and editable by the project owner (or, for an owner-less project,
 * a workspace owner/admin).
 */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  await assertCanManageProject(ctx, projectId);
  const [owner, members, hidden, rows] = await Promise.all([
    projectOwner(projectId),
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
    ownerId: owner.id,
    members: members.map((m) => {
      const isOwner = m.userId === owner.id;
      return {
        ...m.user,
        role: m.role,
        hidden: hiddenIds.has(m.userId),
        locked: isOwner ? "project_owner" : m.userId === user.id ? "self" : null,
        custom: stored.has(m.userId),
        permissions: effectiveCaps(m.role, isOwner, stored.get(m.userId) ?? null),
        defaults: DEFAULT_CAPS[m.role],
        ceiling: CEILING_CAPS[m.role],
      };
    }),
  });
});

const change = z.object({
  userId: uuid,
  /** null = back to the defaults of their workspace role; omitted = unchanged. */
  permissions: z.array(z.enum(PROJECT_CAPS)).max(PROJECT_CAPS.length).nullable().optional(),
  /** true = the project is hidden from them (they can't see or do anything in it). */
  hidden: z.boolean().optional(),
});
const schema = z.object({ changes: z.array(change).min(1).max(1000) });

/** Save the table: all changes apply together, or none (one transaction). */
export const PUT = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  await assertCanManageProject(ctx, projectId);
  const { changes } = schema.parse(await readJson(req));
  const ids = [...new Set(changes.map((c) => c.userId))];
  if (ids.length !== changes.length) throw badRequest("One change per member");
  const [owner, members] = await Promise.all([
    projectOwner(projectId),
    prisma.workspaceMember.findMany({ where: { workspaceId: ctx.workspaceId, userId: { in: ids } }, select: { userId: true, role: true } }),
  ]);
  if (members.length !== ids.length) throw badRequest("Only workspace members have rights in a project");
  const roleOf = new Map(members.map((m) => [m.userId, m.role]));
  for (const c of changes) {
    if (c.userId === owner.id) throw badRequest("The project owner always has full rights - hand the project over to change that");
    if (c.userId === user.id && c.hidden) throw badRequest("You can't hide the project from yourself");
    const role = roleOf.get(c.userId)!;
    const ceiling = new Set<ProjectCap>(CEILING_CAPS[role]);
    const beyond = (c.permissions ?? []).filter((p) => !ceiling.has(p));
    if (beyond.length) throw badRequest(`A ${role} can't be given: ${beyond.join(", ")} - change their workspace role first`);
  }
  await prisma.$transaction(async (tx) => {
    for (const c of changes) {
      if (c.permissions === null) await tx.projectMemberPermission.deleteMany({ where: { projectId, userId: c.userId } });
      else if (c.permissions !== undefined) {
        const permissions = [...new Set(c.permissions)];
        await tx.projectMemberPermission.upsert({
          where: { projectId_userId: { projectId, userId: c.userId } },
          create: { projectId, userId: c.userId, permissions, updatedById: user.id },
          update: { permissions, updatedById: user.id },
        });
      }
      if (c.hidden === true) await tx.projectHiddenMember.upsert({ where: { projectId_userId: { projectId, userId: c.userId } }, create: { projectId, userId: c.userId, createdById: user.id }, update: {} });
      if (c.hidden === false) await tx.projectHiddenMember.deleteMany({ where: { projectId, userId: c.userId } });
    }
    await logActivity(tx, {
      workspaceId: ctx.workspaceId,
      actorId: user.id,
      entityType: "project",
      entityId: projectId,
      action: "updated",
      summary: `Changed project permissions of ${changes.length} member(s)`,
      changes: Object.fromEntries(changes.map((c) => [`permissions:${c.userId}`, { from: null, to: { permissions: c.permissions ?? "unchanged", hidden: c.hidden ?? "unchanged" } }])),
    });
  });
  return NextResponse.json({ ok: true, changed: changes.length });
});
