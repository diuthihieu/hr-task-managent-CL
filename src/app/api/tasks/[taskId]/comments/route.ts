import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfTask, badRequest } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { uuid } from "@/lib/validation";

type P = { taskId: string };

const select = {
  id: true,
  body: true,
  parentCommentId: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true, avatarColor: true } },
} as const;

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const comments = await prisma.comment.findMany({ where: { taskId, deletedAt: null }, orderBy: { createdAt: "asc" }, select });
  return NextResponse.json(comments.map((c) => ({ ...c, user: c.author })));
});

const createSchema = z.object({ body: z.string().trim().min(1, "Comment cannot be empty").max(10000), parentCommentId: uuid.nullable().optional() });

/** Everyone who can see the task (viewers included) can comment. */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const body = createSchema.parse(await readJson(req));
  if (body.parentCommentId && !(await prisma.comment.findFirst({ where: { id: body.parentCommentId, taskId, deletedAt: null } }))) throw badRequest("Parent comment not found");
  const comment = await prisma.$transaction(async (tx) => {
    const c = await tx.comment.create({ data: { taskId, authorId: user.id, body: body.body, parentCommentId: body.parentCommentId ?? null }, select });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "comment", entityId: c.id, action: "created", summary: `Commented on task`, changes: { taskId: { from: null, to: taskId } } });
    return c;
  });
  return NextResponse.json({ ...comment, user: comment.author }, { status: 201 });
});
