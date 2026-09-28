import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWiki, route, readJson, badRequest, hiddenProjectIds } from "@/lib/authz";
import { refreshPageSources, visiblePageWhere } from "@/lib/wiki-sources";
import { logActivity } from "@/lib/activity";
import { serializeWikiSummary } from "@/lib/wiki";
import { sanitizeRichText } from "@/lib/rich-text";
import { uuid } from "@/lib/validation";

type P = { wikiId: string };

/** The wiki's page tree (titles only; content is loaded per page). */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { wikiId } = await params;
  await requireWiki(user, wikiId, "viewer");
  const pages = await prisma.wikiPage.findMany({
    where: { wikiId, deletedAt: null, ...visiblePageWhere(await hiddenProjectIds(user)) },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { updatedBy: { select: { name: true } } },
  });
  // A page under a parent the viewer can't see moves to the top level for them.
  const ids = new Set(pages.map((p) => p.id));
  return NextResponse.json(pages.map((p) => serializeWikiSummary(p.parentPageId && !ids.has(p.parentPageId) ? { ...p, parentPageId: null } : p)));
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  icon: z.string().max(16).nullable().optional(),
  parentPageId: uuid.nullable().optional(),
  content: z.string().nullable().optional(),
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { wikiId } = await params;
  const ctx = await requireWiki(user, wikiId, "editor");
  const body = createSchema.parse(await readJson(req));
  if (body.parentPageId && !(await prisma.wikiPage.findFirst({ where: { id: body.parentPageId, wikiId, deletedAt: null } }))) throw badRequest("Unknown parent page");
  const last = await prisma.wikiPage.aggregate({ where: { wikiId, parentPageId: body.parentPageId ?? null }, _max: { sortOrder: true } });
  const page = await prisma.$transaction(async (tx) => {
    const p = await tx.wikiPage.create({
      data: {
        workspaceId: ctx.workspaceId,
        wikiId,
        parentPageId: body.parentPageId ?? null,
        title: body.title,
        icon: body.icon ?? null,
        content: sanitizeRichText(body.content ?? null),
        sortOrder: (last._max.sortOrder ?? -1) + 1,
        createdById: user.id,
        updatedById: user.id,
      },
      include: { updatedBy: { select: { name: true } } },
    });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "wiki_page", entityId: p.id, action: "created", summary: `Created wiki page "${p.title}"` });
    await refreshPageSources(tx, p.id);
    return p;
  });
  return NextResponse.json(serializeWikiSummary(page), { status: 201 });
});
