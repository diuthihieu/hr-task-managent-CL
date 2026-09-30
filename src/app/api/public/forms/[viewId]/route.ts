import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, badRequest, notFound, HttpError } from "@/lib/authz";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { getOrderedFormFields, isFieldVisible } from "@/lib/form-utils";
import { logActivity } from "@/lib/activity";
import { buildFields, createTask, loadProjectMeta } from "@/lib/task-grid";
import type { FormConfig } from "@/lib/query-engine";

// Anonymous submissions for form views explicitly marked public. Only the
// fields the form shows are exposed or writable; everything else is ignored.
// People fields (assignees, report-to, person/people) are never offered to
// anonymous visitors: that would publish the staff list and let strangers
// assign work to (and notify) anyone. Submissions are rate limited per
// visitor and per form.

const PEOPLE_TYPES = new Set(["person", "people"]);

async function loadPublicForm(viewId: string) {
  const view = await prisma.view.findFirst({ where: { id: viewId, type: "form", isPublic: true, project: { deletedAt: null } } });
  if (!view) return null;
  const meta = await loadProjectMeta(view.projectId);
  if (!meta) return null;
  const config = (view.config ?? {}) as FormConfig;
  const fields = buildFields(meta).filter((f) => !f.readOnly);
  const ordered = getOrderedFormFields(fields, config).filter(({ field, formField }) => formField.visible && !PEOPLE_TYPES.has(field.type));
  return { view, meta, config, ordered };
}

export async function GET(_req: Request, { params }: { params: Promise<{ viewId: string }> }) {
  try {
    const { viewId } = await params;
    const form = await loadPublicForm(viewId);
    if (!form) throw notFound("Form");
    return NextResponse.json({
      tableName: form.meta.project.name,
      fields: form.ordered.map(({ field }) => field),
      members: [],
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
    const ip = clientIp(req);
    const [okVisitor, okForm] = await Promise.all([rateLimit(`form-ip:${viewId}:${ip}`, 10, 3600_000), rateLimit(`form:${viewId}`, 300, 24 * 3600_000)]);
    if (!okVisitor || !okForm) throw new HttpError(429, "Too many submissions - please try again later");
    const raw = await req.text();
    if (raw.length > 100_000) throw new HttpError(413, "Submission is too large");
    let body: { data?: Record<string, unknown>; website?: string };
    try {
      body = (JSON.parse(raw || "{}") ?? {}) as typeof body;
    } catch {
      throw badRequest("Invalid submission");
    }
    // Honeypot: a hidden field that only bots fill in. Pretend success.
    if (body.website) return NextResponse.json({ ok: true }, { status: 201 });
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
