import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, assertCanEditTask, route, readJson, workspaceOfTask } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { sanitizeRichText } from "@/lib/rich-text";
import { shouldLogContentEdit } from "@/lib/content-log";

type P = { taskId: string };

/** The record page body (rich text), kept out of the grid payload. */
export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  await requireWorkspaceRole(user, await workspaceOfTask(taskId), "viewer");
  const t = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { content: true, updatedAt: true } });
  return NextResponse.json({ content: t.content, updatedAt: t.updatedAt.toISOString() });
});

export const PUT = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { taskId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "contributor");
  await assertCanEditTask(ctx, taskId);
  const body = z.object({ content: z.string().nullable() }).parse(await readJson(req));
  const content = sanitizeRichText(body.content);
  const saved = await prisma.$transaction(async (tx) => {
    const t = await tx.task.update({ where: { id: taskId }, data: { content, updatedById: user.id }, select: { title: true, content: true, updatedAt: true } });
    // The editor autosaves; one log entry per editing session is enough.
    if (await shouldLogContentEdit(tx, "task", taskId, user.id)) {
      await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: taskId, action: "updated", summary: `Edited the page of "${t.title}"` });
    }
    return t;
  });
  return NextResponse.json({ content: saved.content, updatedAt: saved.updatedAt.toISOString() });
});
