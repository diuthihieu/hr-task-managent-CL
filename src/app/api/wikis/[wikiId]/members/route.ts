import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWiki, route, readJson, badRequest, roleAtLeast } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { uuid } from "@/lib/validation";

type P = { wikiId: string };

/**
 * Everyone in the workspace with their access to this wiki: explicit role (if
 * added), and whether they're a manager by position (workspace owner/admin or
 * the wiki's creator), which can't be removed here.
 */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { wikiId } = await params;
  const ctx = await requireWiki(user, wikiId, "viewer");
  const [wiki, members] = await Promise.all([
    prisma.wiki.findUniqueOrThrow({ where: { id: wikiId }, select: { createdById: true, members: { select: { userId: true, role: true } } } }),
    prisma.workspaceMember.findMany({ where: { workspaceId: ctx.workspaceId }, include: { user: { select: { id: true, name: true, email: true, avatarColor: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  const explicit = new Map(wiki.members.map((m) => [m.userId, m.role]));
  return NextResponse.json({
    canManage: ctx.wikiRole === "manager",
    members: members.map((m) => ({
      ...m.user,
      workspaceRole: m.role,
      role: explicit.get(m.userId) ?? null,
      lockedReason: roleAtLeast(m.role, "admin") ? "admin" : m.userId === wiki.createdById ? "creator" : null,
    })),
  });
});

const schema = z.object({ members: z.array(z.object({ userId: uuid, role: z.enum(["viewer", "editor", "manager"]) })).max(2000) });

/** Replace the explicit member list (wiki managers). */
export const PUT = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { wikiId } = await params;
  const ctx = await requireWiki(user, wikiId, "manager");
  const body = schema.parse(await readJson(req));
  const ids = [...new Set(body.members.map((m) => m.userId))];
  if (ids.length !== body.members.length) throw badRequest("Each person can be listed once");
  const inWs = await prisma.workspaceMember.count({ where: { workspaceId: ctx.workspaceId, userId: { in: ids } } });
  if (inWs !== ids.length) throw badRequest("Only workspace members can be added to a wiki");
  await prisma.$transaction(async (tx) => {
    await tx.wikiMember.deleteMany({ where: { wikiId } });
    if (body.members.length) await tx.wikiMember.createMany({ data: body.members.map((m) => ({ wikiId, userId: m.userId, role: m.role })) });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "wiki", entityId: wikiId, action: "updated", summary: `Updated wiki access (${body.members.length} member(s))` });
  });
  return NextResponse.json({ ok: true });
});
