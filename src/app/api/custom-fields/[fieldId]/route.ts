import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfCustomField, badRequest } from "@/lib/authz";
import { logActivity, diff } from "@/lib/activity";
import { customFieldPatchSchema, settingsFor, syncOptions, validateFieldConfig } from "@/lib/custom-fields";

type P = { fieldId: string };

export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { fieldId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfCustomField(fieldId), "editor");
  const body = customFieldPatchSchema.parse(await readJson(req));
  const before = await prisma.customField.findUniqueOrThrow({ where: { id: fieldId } });
  // Changing a field's type would reinterpret stored values; create a new field instead.
  if (body.type && body.type !== before.type) throw badRequest("A field's type can't be changed. Create a new field and copy the data.");
  const after = await prisma.$transaction(async (tx) => {
    if (body.config) await validateFieldConfig(tx, before.projectId, before.type, body.config, fieldId);
    const f = await tx.customField.update({
      where: { id: fieldId },
      data: {
        name: body.name,
        description: body.description,
        isRequired: body.isRequired,
        settings: body.config ? settingsFor(before.type, body.config) : undefined,
        updatedById: user.id,
      },
    });
    if (body.config?.options && (f.type === "single_select" || f.type === "multi_select")) await syncOptions(tx, fieldId, body.config.options);
    const changes = diff(before, f, ["name", "description", "isRequired", "settings"]);
    if (changes || body.config?.options) await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "custom_field", entityId: fieldId, action: "updated", changes });
    return f;
  });
  return NextResponse.json({ id: after.id, name: after.name, type: after.type });
});

/** Soft delete: values stay in the database (recoverable) but the column disappears from every view. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { fieldId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfCustomField(fieldId), "editor");
  await prisma.$transaction(async (tx) => {
    const f = await tx.customField.update({ where: { id: fieldId }, data: { deletedAt: new Date(), updatedById: user.id } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "custom_field", entityId: fieldId, action: "deleted", summary: `Deleted field "${f.name}"` });
  });
  return new NextResponse(null, { status: 204 });
});
