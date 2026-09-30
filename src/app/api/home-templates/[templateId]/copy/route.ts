import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, notFound } from "@/lib/authz";
import { TEMPLATE_INCLUDE, serializeTemplate, visibleTemplateWhere } from "@/lib/home-templates";
import { isUuid } from "@/lib/task-grid";

type P = { templateId: string };

/**
 * Save a template someone shared into "My templates" (a private copy the
 * caller can change and share further - never the original).
 */
export const POST = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { templateId } = await params;
  if (!isUuid(templateId)) throw notFound("Template");
  const src = await prisma.homeTemplate.findUnique({ where: { id: templateId }, select: { workspaceId: true } });
  if (!src) throw notFound("Template");
  await requireWorkspaceRole(user, src.workspaceId, "viewer");
  const t = await prisma.homeTemplate.findFirst({ where: { id: templateId, ...visibleTemplateWhere(src.workspaceId, user.id) } });
  if (!t) throw notFound("Template");
  const copy = await prisma.homeTemplate.create({
    data: { workspaceId: t.workspaceId, ownerId: user.id, name: t.name.slice(0, 112) + (t.ownerId === user.id ? " (2)" : ""), description: t.description, widgets: t.widgets ?? [], visibility: "private" },
    include: TEMPLATE_INCLUDE,
  });
  return NextResponse.json(serializeTemplate(copy, user.id, false), { status: 201 });
});
