import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfWikiPage, badRequest } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import { mentionedUserIds, stripMentions } from "@/lib/mentions";
import { detectSourceProjects, refreshPageSources } from "@/lib/wiki-sources";
import { wikiReaders, WIKI_COMMENT_SELECT } from "@/lib/wiki-comments";
import { extractBufferText, isExtractable, MAX_DOC_CHARS } from "@/lib/ai/extract";
import { openAttachment } from "@/lib/storage";
import { logActivity } from "@/lib/activity";

type P = { pageId: string };

export const maxDuration = 60;

const schema = z.object({
  body: z.string().trim().min(1).max(10000),
  parentCommentId: uuid.nullable().optional(),
  /** Files uploaded first via POST /api/wiki/:pageId/attachments (purpose=comment). */
  attachmentIds: z.array(uuid).max(10).optional(),
});

const serialize = (c: { createdAt: Date; updatedAt: Date; attachments: { id: string }[] } & Record<string, unknown>) => ({
  ...c,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
  attachments: c.attachments.map((a) => ({ ...a, downloadUrl: `/api/attachments/${a.id}/download` })),
});

/** Comments on a wiki page, oldest first (anyone who can read the page). */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  const rows = await prisma.wikiComment.findMany({ where: { wikiPageId: pageId, deletedAt: null }, orderBy: { createdAt: "asc" }, select: WIKI_COMMENT_SELECT });
  return NextResponse.json(rows.map(serialize));
});

/**
 * Post a comment: Markdown with @[Name](id) mentions (only people who can
 * open the wiki), optional files. Mentioned people are notified; the text of
 * attached files is extracted so the wiki's AI can read it.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  const body = schema.parse(await readJson(req));
  const page = await prisma.wikiPage.findUniqueOrThrow({ where: { id: pageId }, select: { title: true, wikiId: true, workspace: { select: { slug: true } } } });

  // The page's sources as they will be once this comment is saved (the comment itself may quote a project).
  const current = (await workspaceOfWikiPage(pageId))?.sourceProjectIds ?? [];
  const quoted = await detectSourceProjects(prisma, ctx.workspaceId, stripMentions(body.body));
  const readers = new Set((await wikiReaders(page.wikiId, ctx.workspaceId, [...new Set([...current, ...quoted])])).map((r) => r.id));
  const mentioned = mentionedUserIds(body.body).filter((id) => readers.has(id) && id !== user.id);
  if (body.parentCommentId && !(await prisma.wikiComment.findFirst({ where: { id: body.parentCommentId, wikiPageId: pageId, deletedAt: null }, select: { id: true } })))
    throw badRequest("The comment you reply to is gone");
  const files = body.attachmentIds?.length
    ? await prisma.attachment.findMany({ where: { id: { in: body.attachmentIds }, wikiPageId: pageId, uploadedById: user.id, wikiCommentId: null, deletedAt: null }, select: { id: true, fileName: true, url: true, storageProvider: true } })
    : [];
  if (files.length !== (body.attachmentIds?.length ?? 0)) throw badRequest("Some files are missing - upload them again");

  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.wikiComment.create({ data: { workspaceId: ctx.workspaceId, wikiPageId: pageId, authorId: user.id, parentCommentId: body.parentCommentId ?? null, body: body.body }, select: { id: true } });
    if (mentioned.length) await tx.wikiCommentMention.createMany({ data: mentioned.map((userId) => ({ commentId: c.id, userId })), skipDuplicates: true });
    if (files.length) await tx.attachment.updateMany({ where: { id: { in: files.map((f) => f.id) } }, data: { wikiCommentId: c.id } });
    const excerpt = stripMentions(body.body).slice(0, 180);
    const link = `/w/${page.workspace.slug}/wiki/${page.wikiId}/${pageId}#comments`;
    if (mentioned.length)
      await tx.notification.createMany({
        data: mentioned.map((userId) => ({ userId, workspaceId: ctx.workspaceId, actorId: user.id, type: "mention", title: page.title || "Wiki", body: excerpt, link, data: { where: "wiki" } })),
      });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "wiki_page", entityId: pageId, action: "updated", summary: `Commented on "${page.title}"` });
    await refreshPageSources(tx, pageId);
    return c;
  });

  // Best effort: make the files' text available to the wiki assistant.
  for (const f of files) {
    if (!isExtractable(f.fileName)) continue;
    try {
      const blob = await openAttachment(f.url, f.storageProvider);
      if (!blob) continue;
      const buf = Buffer.from(await new Response(blob.stream).arrayBuffer());
      const text = (await extractBufferText(f.fileName, buf)).slice(0, MAX_DOC_CHARS);
      await prisma.attachment.update({ where: { id: f.id }, data: { extractedText: text } });
    } catch (e) {
      console.warn("[wiki-comment] could not extract", f.fileName, e instanceof Error ? e.message : e);
    }
  }

  const row = await prisma.wikiComment.findUniqueOrThrow({ where: { id: comment.id }, select: WIKI_COMMENT_SELECT });
  return NextResponse.json(serialize(row), { status: 201 });
});
