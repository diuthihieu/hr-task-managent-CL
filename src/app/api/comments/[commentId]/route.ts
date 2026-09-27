import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, roleAtLeast, route, readJson, workspaceOfComment, forbidden } from "@/lib/authz";
import { logActivity } from "@/lib/activity";

type P = { commentId: string };

/** Authors edit their own comments. */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { commentId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfComment(commentId), "viewer");
  const { body } = z.object({ body: z.string().trim().min(1).max(10000) }).parse(await readJson(req));
  const existing = await prisma.comment.findUniqueOrThrow({ where: { id: commentId } });
  if (existing.authorId !== user.id) throw forbidden("You can only edit your own comments");
  const updated = await prisma.$transaction(async (tx) => {
    const c = await tx.comment.update({ where: { id: commentId }, data: { body } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "comment", entityId: commentId, action: "updated", changes: { body: { from: existing.body, to: body } } });
    return c;
  });
  return NextResponse.json({ id: updated.id, body: updated.body, updatedAt: updated.updatedAt });
});

/** Authors delete their own comments; workspace admins can moderate any comment. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { commentId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfComment(commentId), "viewer");
  const existing = await prisma.comment.findUniqueOrThrow({ where: { id: commentId } });
  if (existing.authorId !== user.id && !roleAtLeast(ctx.role, "admin")) throw forbidden("You can only delete your own comments");
  await prisma.$transaction(async (tx) => {
    await tx.comment.update({ where: { id: commentId }, data: { deletedAt: new Date() } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "comment", entityId: commentId, action: "deleted" });
  });
  return new NextResponse(null, { status: 204 });
});
