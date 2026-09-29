import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfWikiPage, forbidden, badRequest, wikiRoleAtLeast } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { refreshPageSources } from "@/lib/wiki-sources";
import { serializeWikiSummary } from "@/lib/wiki";

type P = { pageId: string };

/**
 * Temporal knowledge: start a new version of a page. The old page is kept as
 * history (status "superseded", valid until yesterday) and the new one
 * (version + 1, valid from today) points back to it with "supersedes".
 */
export const POST = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  if (!wikiRoleAtLeast(ctx.wikiRole, "editor")) throw forbidden("You can only read this wiki");
  const old = await prisma.wikiPage.findUniqueOrThrow({ where: { id: pageId }, include: { supersededBy: { select: { id: true, deletedAt: true } } } });
  if (old.supersededBy && !old.supersededBy.deletedAt) throw badRequest("This page already has a newer version");
  const today = new Date(new Date().toISOString().slice(0, 10));
  const yesterday = new Date(today.getTime() - 86400000);
  const page = await prisma.$transaction(async (tx) => {
    if (old.supersededBy) await tx.wikiPage.update({ where: { id: old.supersededBy.id }, data: { supersedesId: null } }); // a deleted newer version
    const last = await tx.wikiPage.aggregate({ where: { wikiId: old.wikiId, parentPageId: old.parentPageId }, _max: { sortOrder: true } });
    const p = await tx.wikiPage.create({
      data: {
        workspaceId: old.workspaceId,
        wikiId: old.wikiId,
        parentPageId: old.parentPageId,
        title: old.title,
        icon: old.icon,
        content: old.content,
        kind: old.kind,
        tags: old.tags,
        status: "current",
        version: old.version + 1,
        supersedesId: old.id,
        validFrom: today,
        sourceType: old.sourceType,
        sourceLabel: old.sourceLabel,
        sourceUrl: old.sourceUrl,
        sourceRef: old.sourceRef,
        confidence: old.confidence,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdById: user.id,
        updatedById: user.id,
      },
      include: { updatedBy: { select: { name: true } } },
    });
    await tx.wikiPage.update({ where: { id: old.id }, data: { status: "superseded", validTo: old.validTo && old.validTo < yesterday ? old.validTo : old.validFrom && old.validFrom > yesterday ? old.validFrom : yesterday } });
    await refreshPageSources(tx, p.id);
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "wiki_page", entityId: p.id, action: "created", summary: `Started version ${p.version} of "${p.title}"` });
    return p;
  });
  return NextResponse.json(serializeWikiSummary(page), { status: 201 });
});
