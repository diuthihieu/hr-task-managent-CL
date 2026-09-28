import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, assertCanManageProject, notFound } from "@/lib/authz";
import { logActivity } from "@/lib/activity";

type P = { docId: string };

async function scope(docId: string) {
  const d = await prisma.knowledgeDoc.findFirst({ where: { id: docId, deletedAt: null, project: { deletedAt: null } }, select: { workspaceId: true, projectId: true, fileName: true } });
  if (!d) throw notFound("Document");
  return d;
}

/** Extracted text preview (managers only). */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { docId } = await params;
  const d = await scope(docId);
  const ctx = await requireWorkspaceRole(user, d, "editor");
  await assertCanManageProject(ctx, d.projectId);
  const row = await prisma.knowledgeDoc.findUniqueOrThrow({ where: { id: docId }, select: { text: true } });
  return NextResponse.json({ fileName: d.fileName, text: row.text.slice(0, 20000), truncated: row.text.length > 20000 });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { docId } = await params;
  const d = await scope(docId);
  const ctx = await requireWorkspaceRole(user, d, "editor");
  await assertCanManageProject(ctx, d.projectId);
  await prisma.$transaction(async (tx) => {
    await tx.knowledgeDoc.update({ where: { id: docId }, data: { deletedAt: new Date() } });
    await logActivity(tx, { workspaceId: d.workspaceId, actorId: user.id, entityType: "project", entityId: d.projectId, action: "updated", summary: `Removed "${d.fileName}" from the wiki assistant's documents` });
  });
  return new NextResponse(null, { status: 204 });
});
