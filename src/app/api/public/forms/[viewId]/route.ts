import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getOrderedFormFields, isFieldVisible } from "@/lib/form-utils";
import type { FormConfig } from "@/lib/query-engine";

async function loadPublicForm(viewId: string) {
  const view = await prisma.view.findUnique({
    where: { id: viewId },
    include: { table: { include: { fields: { orderBy: { order: "asc" } }, base: { select: { workspaceId: true } } } } },
  });
  if (!view || view.type !== "form" || !view.isPublic) return null;
  return view;
}

export async function GET(_req: Request, { params }: { params: Promise<{ viewId: string }> }) {
  const { viewId } = await params;
  const view = await loadPublicForm(viewId);
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId: view.table.base.workspaceId },
    include: { user: { select: { id: true, name: true, avatarColor: true } } },
  });

  return NextResponse.json({
    tableName: view.table.name,
    fields: view.table.fields,
    members: members.map((m) => m.user),
    config: JSON.parse(view.config || "{}"),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ viewId: string }> }) {
  const { viewId } = await params;
  const view = await loadPublicForm(viewId);
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const config: FormConfig = JSON.parse(view.config || "{}");
  const orderedFields = getOrderedFormFields(view.table.fields, config);
  const values: Record<string, unknown> = body.data || {};

  for (const { field, formField } of orderedFields) {
    if (!formField.visible || !formField.required) continue;
    if (!isFieldVisible(field.id, config, values)) continue;
    const v = values[field.id];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) {
      return NextResponse.json({ error: `"${field.name}" is required` }, { status: 400 });
    }
  }

  const data: Record<string, unknown> = {};
  for (const { field, formField } of orderedFields) {
    if (!formField.visible || !isFieldVisible(field.id, config, values)) continue;
    if (values[field.id] !== undefined) data[field.id] = values[field.id];
  }

  const maxOrder = await prisma.record.aggregate({ where: { tableId: view.tableId }, _max: { order: true } });
  const autoNumberFields = view.table.fields.filter((f) => f.type === "auto_number");
  if (autoNumberFields.length) {
    const count = await prisma.record.count({ where: { tableId: view.tableId } });
    for (const f of autoNumberFields) data[f.id] = count + 1;
  }

  await prisma.record.create({
    data: {
      tableId: view.tableId,
      data: JSON.stringify(data),
      order: (maxOrder._max.order ?? 0) + 1,
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
