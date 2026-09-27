import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfCategory } from "@/lib/authz";
import { logActivity, diff } from "@/lib/activity";
import { serializeCategory } from "@/lib/serializers";
import { categorySchema } from "@/lib/validation";

type P = { categoryId: string };

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { categoryId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfCategory(categoryId), "editor");
  const raw = await readJson<Record<string, unknown>>(req);
  const body = categorySchema.partial().parse(raw);
  const order = typeof raw.order === "number" ? Math.round(raw.order) : undefined;
  const before = await prisma.category.findUniqueOrThrow({ where: { id: categoryId } });
  const after = await prisma.$transaction(async (tx) => {
    const c = await tx.category.update({ where: { id: categoryId }, data: { ...body, sortOrder: order, updatedById: user.id } });
    const changes = diff(before, c, ["name", "color"]);
    if (changes) await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "category", entityId: categoryId, action: "updated", changes });
    return c;
  });
  return NextResponse.json(serializeCategory(after));
});

/** Tasks in this category become uncategorized (ON DELETE SET NULL). */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { categoryId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfCategory(categoryId), "editor");
  await prisma.$transaction(async (tx) => {
    const c = await tx.category.delete({ where: { id: categoryId } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "category", entityId: categoryId, action: "deleted", summary: `Deleted category "${c.name}"` });
  });
  return new NextResponse(null, { status: 204 });
});
