import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForBase } from "@/lib/permissions";
import { STATUS_OPTIONS_DEFAULT, PRIORITY_OPTIONS_DEFAULT } from "@/lib/field-types";

export async function GET(_req: Request, { params }: { params: Promise<{ baseId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { baseId } = await params;
  const workspaceId = await getWorkspaceIdForBase(baseId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const tables = await prisma.tableDef.findMany({ where: { baseId }, orderBy: { order: "asc" }, select: { id: true, name: true } });
  return NextResponse.json(tables);
}

export async function POST(req: Request, { params }: { params: Promise<{ baseId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { baseId } = await params;
  const workspaceId = await getWorkspaceIdForBase(baseId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name, template } = await req.json();
  const count = await prisma.tableDef.count({ where: { baseId } });

  const table = await prisma.tableDef.create({
    data: { baseId, name: name || "Untitled Table", order: count },
  });

  // Every new table gets a starter schema so it's immediately usable.
  const defaultFields =
    template === "task"
      ? [
          { name: "Task Name", type: "text", isPrimary: true },
          { name: "Status", type: "status", config: { options: STATUS_OPTIONS_DEFAULT } },
          { name: "Priority", type: "single_select", config: { options: PRIORITY_OPTIONS_DEFAULT } },
          { name: "Owner", type: "person" },
          { name: "Due Date", type: "date" },
          { name: "Progress", type: "progress" },
        ]
      : [{ name: "Name", type: "text", isPrimary: true }];

  await prisma.field.createMany({
    data: defaultFields.map((f, i) => ({
      tableId: table.id,
      name: f.name,
      type: f.type,
      isPrimary: !!f.isPrimary,
      order: i,
      config: f.config ? JSON.stringify(f.config) : null,
    })),
  });

  const fields = await prisma.field.findMany({ where: { tableId: table.id }, orderBy: { order: "asc" } });
  await prisma.view.create({
    data: { tableId: table.id, name: "Grid", type: "grid", isDefault: true, order: 0 },
  });

  return NextResponse.json({ table, fields }, { status: 201 });
}
