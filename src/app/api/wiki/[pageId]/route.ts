import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfWikiPage, badRequest, forbidden, wikiRoleAtLeast } from "@/lib/authz";
import { logActivity, diff } from "@/lib/activity";
import { assertNoWikiCycle, serializeWikiSummary, wikiSubtreeIds } from "@/lib/wiki";
import { sanitizeRichText } from "@/lib/rich-text";
import { shouldLogContentEdit } from "@/lib/content-log";
import { refreshPageSources, restrictingProjects } from "@/lib/wiki-sources";
import { uuid } from "@/lib/validation";

type P = { pageId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  const page = await prisma.wikiPage.findUniqueOrThrow({
    where: { id: pageId },
    include: { updatedBy: { select: { name: true } }, createdBy: { select: { name: true } } },
  });
  return NextResponse.json({ ...serializeWikiSummary(page), content: page.content, createdAt: page.createdAt.toISOString(), createdBy: page.createdBy?.name ?? null, restrictedTo: await restrictingProjects(prisma, page.sourceProjectIds) });
});

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
  const body = patchSchema.parse(await readJson(req));
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
        updatedById: user.id,
      },
      include: { updatedBy: { select: { name: true } } },
    });
    const changes = diff(before, after, ["title", "icon", "parentPageId"]);
    if (changes) await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "wiki_page", entityId: pageId, action: "updated", changes });
    else if (body.content !== undefined && (await shouldLogContentEdit(tx, "wiki_page", pageId, user.id))) {
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "wiki_page", entityId: pageId, action: "updated", summary: `Edited the page "${after.title}"` });
    }
    const sources = body.content !== undefined || body.title !== undefined ? await refreshPageSources(tx, pageId) : after.sourceProjectIds;
    return { ...after, restrictedTo: await restrictingProjects(tx, sources) };
  });
  return NextResponse.json({ ...serializeWikiSummary(page), content: page.content, restrictedTo: page.restrictedTo });
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
