import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, badRequest, notFound } from "@/lib/authz";
import { getOrderedFormFields, isFieldVisible } from "@/lib/form-utils";
import { logActivity } from "@/lib/activity";
import { buildFields, createTask, loadProjectMeta } from "@/lib/task-grid";
import type { FormConfig } from "@/lib/query-engine";

// Anonymous submissions for form views explicitly marked public. Only the
// fields the form shows are exposed or writable; everything else is ignored.

async function loadPublicForm(viewId: string) {
  const view = await prisma.view.findFirst({ where: { id: viewId, type: "form", isPublic: true, project: { deletedAt: null } } });
  if (!view) return null;
  const meta = await loadProjectMeta(view.projectId);
  if (!meta) return null;
  const config = (view.config ?? {}) as FormConfig;
  const fields = buildFields(meta).filter((f) => !f.readOnly);
  const ordered = getOrderedFormFields(fields, config).filter(({ formField }) => formField.visible);
  return { view, meta, config, ordered };
}

export async function GET(_req: Request, { params }: { params: Promise<{ viewId: string }> }) {
  try {
    const { viewId } = await params;
    const form = await loadPublicForm(viewId);
    if (!form) throw notFound("Form");
    const needsMembers = form.ordered.some(({ field }) => field.type === "person" || field.type === "people");
    const members = needsMembers
      ? await prisma.workspaceMember.findMany({
          where: { workspaceId: form.meta.project.workspaceId, user: { isActive: true, deletedAt: null } },
          include: { user: { select: { id: true, name: true, avatarColor: true } } },
        })
      : [];
    return NextResponse.json({
      tableName: form.meta.project.name,
      fields: form.ordered.map(({ field }) => field),
      members: members.map((m) => m.user),
      config: form.config,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ viewId: string }> }) {
  try {
    const { viewId } = await params;
    const form = await loadPublicForm(viewId);
    if (!form) throw notFound("Form");
    const body = (await req.json().catch(() => ({}))) as { data?: Record<string, unknown> };
    const values = body.data && typeof body.data === "object" ? body.data : {};

    for (const { field, formField } of form.ordered) {
      if (!formField.required || !isFieldVisible(field.id, form.config, values)) continue;
      const v = values[field.id];
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) throw badRequest(`"${field.name}" is required`);
    }
    const data: Record<string, unknown> = {};
    for (const { field } of form.ordered) {
      if (!isFieldVisible(field.id, form.config, values)) continue;
      if (values[field.id] !== undefined) data[field.id] = values[field.id];
    }

    await prisma.$transaction(async (tx) => {
      const taskId = await createTask(tx, { projectId: form.view.projectId, workspaceId: form.meta.project.workspaceId, actorId: null, data });
      await logActivity(tx, { workspaceId: form.meta.project.workspaceId, actorId: null, entityType: "task", entityId: taskId, action: "created", summary: `Submitted via public form "${form.view.name}"` });
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
