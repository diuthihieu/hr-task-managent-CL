import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { customFieldCreateSchema, syncOptions, settingsFor, validateFieldConfig } from "@/lib/custom-fields";

type P = { projectId: string };

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { projectId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfProject(projectId), "editor");
  const body = customFieldCreateSchema.parse(await readJson(req));
  const last = await prisma.customField.aggregate({ where: { projectId, deletedAt: null }, _max: { sortOrder: true } });
  const field = await prisma.$transaction(async (tx) => {
    const config = { ...(body.config ?? {}), ...(body.type === "link" ? { linkProjectId: projectId } : {}) };
    await validateFieldConfig(tx, projectId, body.type, config);
    const f = await tx.customField.create({
      data: {
        projectId,
        name: body.name,
        type: body.type,
        description: body.description ?? null,
        isRequired: body.isRequired ?? false,
        settings: settingsFor(body.type, config),
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        createdById: user.id,
        updatedById: user.id,
      },
    });
    if (body.type === "single_select" || body.type === "multi_select") await syncOptions(tx, f.id, body.config?.options ?? []);
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "custom_field", entityId: f.id, action: "created", summary: `Added field "${f.name}" (${f.type})` });
    return f;
  });
  return NextResponse.json({ id: field.id, name: field.name, type: field.type }, { status: 201 });
});
