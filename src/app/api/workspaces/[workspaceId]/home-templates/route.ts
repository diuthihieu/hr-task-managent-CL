import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, forbidden, roleAtLeast } from "@/lib/authz";
import { normalizeWidgets, widgetsSchema } from "@/lib/home-widgets";
import { TEMPLATE_INCLUDE, serializeTemplate, visibleTemplateWhere, checkShareTargets, notifyShared, asJson } from "@/lib/home-templates";

type P = { workspaceId: string };

/** Home templates: { mine, shared } - shared = the workspace's public ones and those shared with the caller. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  const rows = await prisma.homeTemplate.findMany({ where: visibleTemplateWhere(workspaceId, user.id), include: TEMPLATE_INCLUDE, orderBy: [{ updatedAt: "desc" }], take: 200 });
  const all = rows.map((r) => serializeTemplate(r, user.id, roleAtLeast(ctx.role, "admin")));
  return NextResponse.json({ mine: all.filter((x) => x.mine), shared: all.filter((x) => !x.mine) });
});

const schema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullish(),
  widgets: widgetsSchema.min(1),
  visibility: z.enum(["private", "workspace", "shared"]).default("private"),
  shareWith: z.array(z.string().uuid()).max(50).default([]),
});

/**
 * Package a Home design as a template. Private or shared with chosen members
 * for anyone; publishing to the whole workspace needs editor rights.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  const body = schema.parse(await readJson(req));
  if (body.visibility === "workspace" && !roleAtLeast(ctx.role, "editor")) throw forbidden("Only editors, admins and owners can publish a template to the whole workspace");
  const share = body.visibility === "shared" ? await checkShareTargets(workspaceId, user.id, body.shareWith) : [];
  const t = await prisma.$transaction(async (tx) => {
    const created = await tx.homeTemplate.create({
      data: { workspaceId, ownerId: user.id, name: body.name, description: body.description || null, widgets: asJson(normalizeWidgets(body.widgets)), visibility: body.visibility, shares: { create: share.map((userId) => ({ userId })) } },
      include: TEMPLATE_INCLUDE,
    });
    if (share.length) await notifyShared(tx, workspaceId, user.id, created.id, created.name, share);
    return created;
  });
  return NextResponse.json(serializeTemplate(t, user.id, false), { status: 201 });
});
