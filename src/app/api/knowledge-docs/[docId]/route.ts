import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWiki, route, notFound, forbidden, wikiRoleAtLeast } from "@/lib/authz";
import { logActivity } from "@/lib/activity";

type P = { docId: string };

async function scope(docId: string) {
  const d = await prisma.knowledgeDoc.findFirst({ where: { id: docId, deletedAt: null, wiki: { deletedAt: null } }, select: { workspaceId: true, wikiId: true, fileName: true, createdById: true } });
  if (!d) throw notFound("Document");
  return d;
}

/** Extracted text preview (the wiki's editors and managers). */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { docId } = await params;
  const d = await scope(docId);
  await requireWiki(user, d.wikiId, "editor");
  const row = await prisma.knowledgeDoc.findUniqueOrThrow({ where: { id: docId }, select: { text: true } });
  return NextResponse.json({ fileName: d.fileName, text: row.text.slice(0, 20000), truncated: row.text.length > 20000 });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { docId } = await params;
  const d = await scope(docId);
  const ctx = await requireWiki(user, d.wikiId, "editor");
  if (d.createdById !== user.id && !wikiRoleAtLeast(ctx.wikiRole, "manager")) throw forbidden("Only the uploader or a wiki manager can remove this document");
  await prisma.$transaction(async (tx) => {
    await tx.knowledgeDoc.update({ where: { id: docId }, data: { deletedAt: new Date() } });
    await logActivity(tx, { workspaceId: d.workspaceId, actorId: user.id, entityType: "wiki", entityId: d.wikiId, action: "updated", summary: `Removed "${d.fileName}" from the wiki assistant's documents` });
  });
  return new NextResponse(null, { status: 204 });
});
