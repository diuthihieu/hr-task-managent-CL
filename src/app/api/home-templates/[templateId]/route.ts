import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, notFound, forbidden, roleAtLeast } from "@/lib/authz";
import { normalizeWidgets, widgetsSchema } from "@/lib/home-widgets";
import { TEMPLATE_INCLUDE, serializeTemplate, checkShareTargets, notifyShared, asJson } from "@/lib/home-templates";
import { isUuid } from "@/lib/task-grid";

type P = { templateId: string };

async function load(templateId: string) {
  if (!isUuid(templateId)) throw notFound("Template");
  const t = await prisma.homeTemplate.findUnique({ where: { id: templateId }, include: TEMPLATE_INCLUDE });
  if (!t) throw notFound("Template");
  return t;
}

const schema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullish(),
  widgets: widgetsSchema.min(1).optional(),
  visibility: z.enum(["private", "workspace", "shared"]).optional(),
  shareWith: z.array(z.string().uuid()).max(50).optional(),
});

/** The owner renames, updates, re-publishes or re-shares their template. */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { templateId } = await params;
  const t = await load(templateId);
  const ctx = await requireWorkspaceRole(user, t.workspaceId, "viewer");
  if (t.ownerId !== user.id) throw notFound("Template");
  const body = schema.parse(await readJson(req));
  const visibility = body.visibility ?? t.visibility;
  if (visibility === "workspace" && t.visibility !== "workspace" && !roleAtLeast(ctx.role, "editor")) throw forbidden("Only editors, admins and owners can publish a template to the whole workspace");
  const before = new Set(t.shares.map((s) => s.user.id));
  const share = visibility === "shared" ? (body.shareWith ? await checkShareTargets(t.workspaceId, user.id, body.shareWith) : [...before]) : [];
  const updated = await prisma.$transaction(async (tx) => {
    await tx.homeTemplateShare.deleteMany({ where: { templateId, userId: { notIn: share } } });
    const added = share.filter((id) => !before.has(id));
    if (added.length) await tx.homeTemplateShare.createMany({ data: added.map((userId) => ({ templateId, userId })), skipDuplicates: true });
    const row = await tx.homeTemplate.update({
      where: { id: templateId },
      data: { name: body.name, description: body.description === undefined ? undefined : body.description || null, widgets: body.widgets ? asJson(normalizeWidgets(body.widgets)) : undefined, visibility },
      include: TEMPLATE_INCLUDE,
    });
    await notifyShared(tx, t.workspaceId, user.id, templateId, row.name, added);
    return row;
  });
  return NextResponse.json(serializeTemplate(updated, user.id, false));
});

/** The owner deletes it; workspace admins may also remove workspace-wide ones. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { templateId } = await params;
  const t = await load(templateId);
  const ctx = await requireWorkspaceRole(user, t.workspaceId, "viewer");
  const allowed = t.ownerId === user.id || (t.visibility === "workspace" && roleAtLeast(ctx.role, "admin"));
  if (!allowed) throw t.visibility === "private" ? notFound("Template") : forbidden("Only the owner can delete this template");
  await prisma.homeTemplate.delete({ where: { id: templateId } });
  return new NextResponse(null, { status: 204 });
});
