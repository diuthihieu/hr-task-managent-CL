import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfView, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { serializeView } from "@/lib/serializers";

type P = { viewId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { viewId } = await params;
  await requireWorkspaceRole(user, await workspaceOfView(viewId), "viewer");
  return NextResponse.json(serializeView(await prisma.view.findUniqueOrThrow({ where: { id: viewId } })));
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  order: z.number().int().optional(),
  isDefault: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { viewId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfView(viewId), "editor");
  const body = patchSchema.parse(await readJson(req));
  const before = await prisma.view.findUniqueOrThrow({ where: { id: viewId } });
  if (body.isPublic && before.type !== "form") throw badRequest("Only form views can be public");
  const view = await prisma.$transaction(async (tx) => {
    if (body.isDefault) await tx.view.updateMany({ where: { projectId: before.projectId, id: { not: viewId } }, data: { isDefault: false } });
    const v = await tx.view.update({
      where: { id: viewId },
      data: {
        name: body.name,
        config: body.config as Prisma.InputJsonValue | undefined,
        sortOrder: body.order,
        isDefault: body.isDefault,
        isPublic: body.isPublic,
        updatedById: user.id,
      },
    });
    // Config edits (filters, widths...) are UI state - only log structural changes.
    if (body.name || body.isPublic !== undefined) {
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "view", entityId: viewId, action: "updated", changes: { ...(body.name ? { name: { from: before.name, to: body.name } } : {}), ...(body.isPublic !== undefined ? { isPublic: { from: before.isPublic, to: body.isPublic } } : {}) } });
    }
    return v;
  });
  return NextResponse.json(serializeView(view));
});

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { viewId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfView(viewId), "editor");
  const view = await prisma.view.findUniqueOrThrow({ where: { id: viewId } });
  if ((await prisma.view.count({ where: { projectId: view.projectId } })) <= 1) throw badRequest("A project needs at least one view");
  await prisma.$transaction(async (tx) => {
    await tx.view.delete({ where: { id: viewId } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "view", entityId: viewId, action: "deleted", summary: `Deleted view "${view.name}"` });
  });
  return new NextResponse(null, { status: 204 });
});
