import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWiki, route, readJson } from "@/lib/authz";
import { logActivity, diff } from "@/lib/activity";
import { serializeWiki, WIKI_SELECT } from "@/lib/wiki";
import { wikiInputSchema } from "@/app/api/workspaces/[workspaceId]/wikis/route";

type P = { wikiId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { wikiId } = await params;
  const ctx = await requireWiki(user, wikiId, "viewer");
  const w = await prisma.wiki.findUniqueOrThrow({ where: { id: wikiId }, select: WIKI_SELECT });
  return NextResponse.json(serializeWiki(w, ctx.wikiRole));
});

/** Rename, restyle or change who can see it (wiki managers). */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { wikiId } = await params;
  const ctx = await requireWiki(user, wikiId, "manager");
  const body = wikiInputSchema.partial().parse(await readJson(req));
  const w = await prisma.$transaction(async (tx) => {
    const before = await tx.wiki.findUniqueOrThrow({ where: { id: wikiId } });
    const after = await tx.wiki.update({ where: { id: wikiId }, data: body, select: WIKI_SELECT });
    const changes = diff(before, { ...before, ...body }, ["name", "description", "icon", "color", "access", "defaultRole"]);
    if (changes) await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "wiki", entityId: wikiId, action: "updated", changes });
    return after;
  });
  return NextResponse.json(serializeWiki(w, ctx.wikiRole));
});

/** Soft delete (wiki managers). Pages stay in the database. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { wikiId } = await params;
  const ctx = await requireWiki(user, wikiId, "manager");
  await prisma.$transaction(async (tx) => {
    const w = await tx.wiki.update({ where: { id: wikiId }, data: { deletedAt: new Date() } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "wiki", entityId: wikiId, action: "deleted", summary: `Deleted wiki "${w.name}"` });
  });
  return new NextResponse(null, { status: 204 });
});
