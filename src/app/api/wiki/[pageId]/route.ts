import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfWikiPage, badRequest, forbidden, wikiRoleAtLeast } from "@/lib/authz";
import { logActivity, diff } from "@/lib/activity";
import { assertNoWikiCycle, serializeKnowledgeMeta, serializeWikiSummary, wikiSubtreeIds } from "@/lib/wiki";
import { knowledgeMetaSchema, toDate } from "@/lib/brain/meta-schema";
import { sanitizeRichText } from "@/lib/rich-text";
import { shouldLogContentEdit } from "@/lib/content-log";
import { refreshPageSources, restrictingProjects } from "@/lib/wiki-sources";
import { uuid } from "@/lib/validation";

type P = { pageId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  const page = await loadPage(pageId);
  // Reading activity for Knowledge health ("never revisited"); at most one count per 10 minutes.
  if (!page.lastViewedAt || Date.now() - page.lastViewedAt.getTime() > 10 * 60_000)
    await prisma.$executeRaw`UPDATE wiki_pages SET view_count = view_count + 1, last_viewed_at = now() WHERE id = ${pageId}::uuid`;
  return NextResponse.json(await fullPage(page, ctx.wikiRole ?? null));
});

async function loadPage(pageId: string) {
  return prisma.wikiPage.findUniqueOrThrow({
    where: { id: pageId },
    include: {
      updatedBy: { select: { name: true } },
      createdBy: { select: { name: true } },
      supersedes: { select: { id: true, title: true, version: true, deletedAt: true } },
      supersededBy: { select: { id: true, title: true, version: true, deletedAt: true } },
    },
  });
}

async function fullPage(page: Awaited<ReturnType<typeof loadPage>>, wikiRole: string | null) {
  const checker = page.lastCheckedById ? await prisma.user.findUnique({ where: { id: page.lastCheckedById }, select: { name: true } }) : null;
  const live = (p: { id: string; title: string; version: number; deletedAt: Date | null } | null) => (p && !p.deletedAt ? { id: p.id, title: p.title, version: p.version } : null);
  return {
    ...serializeWikiSummary(page),
    content: page.content,
    createdAt: page.createdAt.toISOString(),
    createdBy: page.createdBy?.name ?? null,
    restrictedTo: await restrictingProjects(prisma, page.sourceProjectIds),
    meta: serializeKnowledgeMeta({ ...page, supersedes: live(page.supersedes), supersededBy: live(page.supersededBy), lastCheckedByName: checker?.name ?? null }),
    myWikiRole: wikiRole,
  };
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  icon: z.string().max(16).nullable().optional(),
  content: z.string().nullable().optional(),
  parentPageId: uuid.nullable().optional(),
  order: z.number().int().optional(),
});

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  if (!wikiRoleAtLeast(ctx.wikiRole, "editor")) throw forbidden("You can only read this wiki");
  const raw = await readJson(req);
  const body = patchSchema.parse(raw);
  const meta = knowledgeMetaSchema.parse(raw);
  const page = await prisma.$transaction(async (tx) => {
    const before = await tx.wikiPage.findUniqueOrThrow({ where: { id: pageId } });
    if (body.parentPageId) {
      if (!(await tx.wikiPage.findFirst({ where: { id: body.parentPageId, wikiId: before.wikiId, deletedAt: null } }))) throw badRequest("Unknown parent page");
      await assertNoWikiCycle(tx, pageId, body.parentPageId);
    }
    const after = await tx.wikiPage.update({
      where: { id: pageId },
      data: {
        title: body.title,
        icon: body.icon,
        content: body.content !== undefined ? sanitizeRichText(body.content) : undefined,
        parentPageId: body.parentPageId,
        sortOrder: body.order,
        kind: meta.kind,
        status: meta.status,
        tags: meta.tags,
        validFrom: toDate(meta.validFrom),
        validTo: toDate(meta.validTo),
        eventDate: toDate(meta.eventDate),
        sourceType: meta.sourceType,
        sourceLabel: meta.sourceLabel,
        sourceUrl: meta.sourceUrl,
        confidence: meta.confidence,
        ...(meta.markChecked ? { lastCheckedAt: new Date(), lastCheckedById: user.id } : {}),
        updatedById: user.id,
      },
      include: { updatedBy: { select: { name: true } } },
    });
    const vf = after.validFrom, vt = after.validTo;
    if (vf && vt && vt < vf) throw badRequest("Valid to must be on or after valid from");
    const changes = diff(before, after, ["title", "icon", "parentPageId", "kind", "status", "tags", "validFrom", "validTo", "sourceLabel", "sourceUrl", "confidence"]);
    if (changes) await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "wiki_page", entityId: pageId, action: "updated", changes });
    else if (body.content !== undefined && (await shouldLogContentEdit(tx, "wiki_page", pageId, user.id))) {
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "wiki_page", entityId: pageId, action: "updated", summary: `Edited the page "${after.title}"` });
    }
    const sources = body.content !== undefined || body.title !== undefined ? await refreshPageSources(tx, pageId) : after.sourceProjectIds;
    return { ...after, restrictedTo: await restrictingProjects(tx, sources) };
  });
  return NextResponse.json({ ...(await fullPage(await loadPage(pageId), ctx.wikiRole ?? null)), restrictedTo: page.restrictedTo });
});

/** Soft-deletes the page and its sub-pages (wiki editors). */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  if (!wikiRoleAtLeast(ctx.wikiRole, "editor")) throw forbidden("You can only read this wiki");
  const page = await prisma.wikiPage.findUniqueOrThrow({ where: { id: pageId }, select: { title: true } });
  await prisma.$transaction(async (tx) => {
    const ids = await wikiSubtreeIds(tx, pageId);
    await tx.wikiPage.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date(), deletedById: user.id } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "wiki_page", entityId: pageId, action: "deleted", summary: `Deleted wiki page "${page.title}"${ids.length > 1 ? ` and ${ids.length - 1} sub-page(s)` : ""}` });
  });
  return new NextResponse(null, { status: 204 });
});
