import { NextResponse } from "next/server";
import { withCurrentMentionNames } from "@/lib/mentions-server";
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
import { sanitizeCommentBody } from "@/lib/comment-rich-text-server";
import { assertCursor, pageArgs, readPage, toPage } from "@/lib/pagination";

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

/** Replies shown per comment; `replyCount` on the comment tells how many there are in all. */
const MAX_REPLIES = 100;

/**
 * Comments on a wiki page (anyone who can read the page): `{ items, nextCursor }`, a page of
 * top-level comments, newest page first (`?cursor=` loads older ones), in display order - oldest
 * first, each followed by its replies (at most 100). Deleting a comment keeps its replies (product
 * decision), so a reply whose comment was deleted counts as a top-level comment.
 */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  const page = readPage(req);
  const roots = { wikiPageId: pageId, deletedAt: null, OR: [{ parentCommentId: null }, { parent: { deletedAt: { not: null } } }] };
  if (page.cursor) assertCursor(await prisma.wikiComment.findFirst({ where: { ...roots, id: page.cursor }, select: { id: true } }));
  const rows = await prisma.wikiComment.findMany({
    where: roots,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    ...pageArgs(page),
    select: {
      ...WIKI_COMMENT_SELECT,
      replies: { where: { deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: MAX_REPLIES, select: WIKI_COMMENT_SELECT },
      _count: { select: { replies: { where: { deletedAt: null } } } },
    },
  });
  const { items, nextCursor } = toPage(rows, page);
  const flat = items.reverse().flatMap(({ replies, _count, ...comment }) => [{ ...comment, replyCount: _count.replies }, ...replies]);
  return NextResponse.json({ items: (await withCurrentMentionNames(flat)).map(serialize), nextCursor });
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
  const commentBody = sanitizeCommentBody(body.body);
  const page = await prisma.wikiPage.findUniqueOrThrow({ where: { id: pageId }, select: { title: true, wikiId: true, workspace: { select: { slug: true } } } });

  // The page's sources as they will be once this comment is saved (the comment itself may quote a project).
  const current = (await workspaceOfWikiPage(pageId))?.sourceProjectIds ?? [];
  const quoted = await detectSourceProjects(prisma, ctx.workspaceId, stripMentions(commentBody));
  const readers = new Set((await wikiReaders(page.wikiId, ctx.workspaceId, [...new Set([...current, ...quoted])])).map((r) => r.id));
  const mentioned = mentionedUserIds(commentBody).filter((id) => readers.has(id) && id !== user.id);
  const parent = body.parentCommentId ? await prisma.wikiComment.findFirst({ where: { id: body.parentCommentId, wikiPageId: pageId, deletedAt: null }, select: { id: true, parentCommentId: true } }) : null;
  // Replying to a reply joins the same thread (one level).
  const parentCommentId = parent ? (parent.parentCommentId ?? parent.id) : null;
  if (body.parentCommentId && !parent)
    throw badRequest("The comment you reply to is gone");
  const files = body.attachmentIds?.length
    // Unpaged on purpose: ids from the request (max 10 files).
    ? await prisma.attachment.findMany({ where: { id: { in: body.attachmentIds }, wikiPageId: pageId, uploadedById: user.id, wikiCommentId: null, deletedAt: null }, select: { id: true, fileName: true, url: true, storageProvider: true } })
    : [];
  if (files.length !== (body.attachmentIds?.length ?? 0)) throw badRequest("Some files are missing - upload them again");

  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.wikiComment.create({ data: { workspaceId: ctx.workspaceId, wikiPageId: pageId, authorId: user.id, parentCommentId, body: commentBody }, select: { id: true } });
    if (mentioned.length) await tx.wikiCommentMention.createMany({ data: mentioned.map((userId) => ({ commentId: c.id, userId })), skipDuplicates: true });
    if (files.length) await tx.attachment.updateMany({ where: { id: { in: files.map((f) => f.id) } }, data: { wikiCommentId: c.id } });
    const excerpt = stripMentions(commentBody).slice(0, 180);
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
      const text = (await extractBufferText(f.fileName, buf, ctx.workspaceId)).slice(0, MAX_DOC_CHARS);
      await prisma.attachment.update({ where: { id: f.id }, data: { extractedText: text } });
    } catch (e) {
      console.warn("[wiki-comment] could not extract", f.fileName, e instanceof Error ? e.message : e);
    }
  }

  const row = await prisma.wikiComment.findUniqueOrThrow({ where: { id: comment.id }, select: WIKI_COMMENT_SELECT });
  return NextResponse.json(serialize(row), { status: 201 });
});
