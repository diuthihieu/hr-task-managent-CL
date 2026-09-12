import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/permissions";
import { migrateFieldValue, parseFieldConfig } from "@/lib/field-types";

async function workspaceIdForField(fieldId: string) {
  const field = await prisma.field.findUnique({
    where: { id: fieldId },
    select: { table: { select: { base: { select: { workspaceId: true } } } } },
  });
  return field?.table.base.workspaceId ?? null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ fieldId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { fieldId } = await params;
  const workspaceId = await workspaceIdForField(fieldId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.description !== undefined) data.description = body.description;
  if (body.visible !== undefined) data.visible = body.visible;
  if (body.order !== undefined) data.order = body.order;
  if (body.type !== undefined) data.type = body.type;
  if (body.config !== undefined) data.config = body.config ? JSON.stringify(body.config) : null;

  const existing = await prisma.field.findUnique({ where: { id: fieldId } });
  const typeChanged = existing && body.type !== undefined && body.type !== existing.type;

  const field = await prisma.field.update({ where: { id: fieldId }, data });

  // Safe field-type migration: coerce every existing record's cell value for
  // this field instead of leaving it to render against a type it was never
  // written for, and never delete data we don't know how to convert.
  if (typeChanged && existing) {
    const oldConfig = parseFieldConfig(existing.config);
    const records = await prisma.record.findMany({ where: { tableId: existing.tableId }, select: { id: true, data: true } });
    const updates = records
      .map((r) => {
        const parsed = JSON.parse(r.data || "{}") as Record<string, unknown>;
        if (!(fieldId in parsed)) return null;
        const migrated = migrateFieldValue(existing.type, field.type, parsed[fieldId], oldConfig);
        parsed[fieldId] = migrated;
        return { id: r.id, data: JSON.stringify(parsed) };
      })
      .filter(Boolean) as { id: string; data: string }[];
    if (updates.length) {
      await prisma.$transaction(updates.map((u) => prisma.record.update({ where: { id: u.id }, data: { data: u.data } })));
    }
  }

  return NextResponse.json(field);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ fieldId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { fieldId } = await params;
  const workspaceId = await workspaceIdForField(fieldId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.field.delete({ where: { id: fieldId } });
  return NextResponse.json({ ok: true });
}
