import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWiki, route, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { extractDocText } from "@/lib/ai/extract";
import { safeFileName } from "@/lib/storage";

type P = { wikiId: string };

export const maxDuration = 120;

const select = { id: true, fileName: true, contentType: true, sizeBytes: true, charCount: true, createdAt: true, createdBy: { select: { name: true } } } as const;
type Row = { id: string; fileName: string; contentType: string; sizeBytes: number; charCount: number; createdAt: Date; createdBy: { name: string } | null };
const toRow = (d: Row) => ({ ...d, createdAt: d.createdAt.toISOString(), createdBy: d.createdBy?.name ?? null });

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { wikiId } = await params;
  await requireWiki(user, wikiId, "viewer");
  const docs = await prisma.knowledgeDoc.findMany({ where: { wikiId, deletedAt: null }, orderBy: { createdAt: "desc" }, select });
  return NextResponse.json(docs.map(toRow));
});

/** Upload a reference document (multipart `file`); its text is extracted and stored for the wiki assistant. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { wikiId } = await params;
  const ctx = await requireWiki(user, wikiId, "manager");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Send the document as multipart form field `file`");
  const text = await extractDocText(file);
  const doc = await prisma.$transaction(async (tx) => {
    const d = await tx.knowledgeDoc.create({
      data: {
        workspaceId: ctx.workspaceId,
        wikiId,
        fileName: safeFileName(file.name),
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        text,
        charCount: text.length,
        createdById: user.id,
      },
      select,
    });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "wiki", entityId: wikiId, action: "updated", summary: `Added "${d.fileName}" to the wiki assistant's documents` });
    return d;
  });
  return NextResponse.json(toRow(doc), { status: 201 });
});
