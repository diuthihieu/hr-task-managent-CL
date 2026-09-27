import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { serializeWikiSummary } from "@/lib/wiki";
import { sanitizeRichText } from "@/lib/rich-text";
import { uuid } from "@/lib/validation";

type P = { projectId: string };

/** The project's wiki tree (titles only; content is loaded per page). */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  await requireWorkspaceRole(user, await workspaceOfProject(projectId), "viewer");
  const pages = await prisma.wikiPage.findMany({
    where: { projectId, deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { updatedBy: { select: { name: true } } },
  });
  return NextResponse.json(pages.map(serializeWikiSummary));
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(300),
  icon: z.string().max(16).nullable().optional(),
  parentPageId: uuid.nullable().optional(),
  content: z.string().nullable().optional(),
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "contributor");
  const body = createSchema.parse(await readJson(req));
  if (body.parentPageId && !(await prisma.wikiPage.findFirst({ where: { id: body.parentPageId, projectId, deletedAt: null } }))) throw badRequest("Unknown parent page");
  const last = await prisma.wikiPage.aggregate({ where: { projectId, parentPageId: body.parentPageId ?? null }, _max: { sortOrder: true } });
  const page = await prisma.$transaction(async (tx) => {
    const p = await tx.wikiPage.create({
      data: {
        workspaceId: ctx.workspaceId,
        projectId,
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
    return p;
  });
  return NextResponse.json(serializeWikiSummary(page), { status: 201 });
});
