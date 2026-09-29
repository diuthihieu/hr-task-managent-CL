import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfWikiPage, workspaceOfProject, badRequest } from "@/lib/authz";
import { createTask, SYS } from "@/lib/task-grid";
import { notifyTaskCreated } from "@/lib/notifications";
import { logActivity } from "@/lib/activity";
import { sanitizeRichText } from "@/lib/rich-text";
import { entityHref } from "@/lib/brain/links-core";
import { uuid } from "@/lib/validation";

type P = { pageId: string };

const schema = z.object({
  projectId: uuid,
  title: z.string().trim().min(1).max(500),
  /** The highlighted text (plain). */
  text: z.string().max(4000).default(""),
  blockId: z.string().regex(/^[a-z0-9]{6,16}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  assignToMe: z.boolean().default(true),
  recurrence: z.object({ freq: z.enum(["daily", "weekly", "monthly"]), interval: z.number().int().min(1).max(365).default(1) }).nullable().optional(),
  /** "kr:<id>" or "obj:<id>" */
  okr: z.string().regex(/^(kr|obj):[0-9a-f-]{36}$/).nullable().optional(),
});

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Convert highlighted wiki text into a task (optionally recurring / linked to
 * an OKR). The task page quotes the text and links back to the exact block, so
 * the page shows the task in its backlinks and the task shows where it came from.
 */
export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { pageId } = await params;
  const pageCtx = await requireWorkspaceRole(user, await workspaceOfWikiPage(pageId), "viewer");
  const body = schema.parse(await readJson(req));
  const projectCtx = await requireWorkspaceRole(user, await workspaceOfProject(body.projectId), "contributor");
  if (projectCtx.workspaceId !== pageCtx.workspaceId) throw badRequest("The project is in another workspace");
  const [page, ws] = await Promise.all([
    prisma.wikiPage.findUniqueOrThrow({ where: { id: pageId }, select: { id: true, title: true, wikiId: true } }),
    prisma.workspace.findUniqueOrThrow({ where: { id: pageCtx.workspaceId }, select: { slug: true } }),
  ]);
  const source = entityHref(`/w/${ws.slug}`, { type: "wiki", id: page.id, wikiId: page.wikiId, blockId: body.blockId })!;
  const content = sanitizeRichText(`<p>From wiki: <a href="${esc(source)}">${esc(page.title || "Untitled")}</a></p>${body.text.trim() ? `<blockquote><p>${esc(body.text.trim())}</p></blockquote>` : ""}`);
  const result = await prisma.$transaction(async (tx) => {
    const data: Record<string, unknown> = { [SYS.title]: body.title };
    if (body.dueDate) data[SYS.dueDate] = body.dueDate;
    if (body.assignToMe) data[SYS.assignees] = [user.id];
    if (body.recurrence) data[SYS.recurrence] = body.recurrence;
    if (body.okr) data[SYS.objective] = body.okr;
    const taskId = await createTask(tx, { projectId: body.projectId, workspaceId: projectCtx.workspaceId, actorId: user.id, data });
    await tx.task.update({ where: { id: taskId }, data: { content } });
    await notifyTaskCreated(tx, taskId, user.id);
    await logActivity(tx, { workspaceId: projectCtx.workspaceId, actorId: user.id, entityType: "task", entityId: taskId, action: "created", summary: `Created task "${body.title}" from wiki page "${page.title}"` });
    return taskId;
  });
  return NextResponse.json({ id: result, projectId: body.projectId, href: entityHref(`/w/${ws.slug}`, { type: "task", id: result, projectId: body.projectId }) }, { status: 201 });
});
