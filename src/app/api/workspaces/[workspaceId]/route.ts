import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson } from "@/lib/authz";
import { logActivity, diff } from "@/lib/activity";
import { nameSchema } from "@/lib/validation";
import { workspaceLogoUrl } from "@/lib/workspace-logo";

type P = { workspaceId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  const w = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  return NextResponse.json({ id: w.id, name: w.name, slug: w.slug, description: w.description, logoUrl: workspaceLogoUrl(w), createdAt: w.createdAt.toISOString(), role: ctx.role, aiEnabled: w.aiEnabled });
});

const patchSchema = z.object({ name: nameSchema.optional(), description: z.string().max(2000).nullable().optional(), aiEnabled: z.boolean().optional() });

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "admin");
  const body = patchSchema.parse(await readJson(req));
  const w = await prisma.$transaction(async (tx) => {
    const before = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    const after = await tx.workspace.update({ where: { id: workspaceId }, data: { ...body, updatedById: user.id } });
    const changes = diff(before, after, ["name", "description", "aiEnabled"]);
    if (changes) await logActivity(tx, { workspaceId, actorId: user.id, entityType: "workspace", entityId: workspaceId, action: "updated", changes });
    return after;
  });
  return NextResponse.json({ id: w.id, name: w.name, slug: w.slug, description: w.description, logoUrl: workspaceLogoUrl(w), aiEnabled: w.aiEnabled });
});

/** Soft delete; workspace owners (or system admins). */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "owner");
  await prisma.$transaction(async (tx) => {
    await tx.workspace.update({ where: { id: workspaceId }, data: { deletedAt: new Date(), updatedById: user.id } });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "workspace", entityId: workspaceId, action: "deleted" });
  });
  return new NextResponse(null, { status: 204 });
});
