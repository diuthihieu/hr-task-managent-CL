import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForTable } from "@/lib/permissions";

export async function POST(req: Request, { params }: { params: Promise<{ tableId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tableId } = await params;
  const workspaceId = await getWorkspaceIdForTable(tableId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { name, type, config, description, insertAfterOrder } = body;

  if (typeof insertAfterOrder === "number") {
    await prisma.field.updateMany({
      where: { tableId, order: { gt: insertAfterOrder } },
      data: { order: { increment: 1 } },
    });
  }
  const order = typeof insertAfterOrder === "number" ? insertAfterOrder + 1 : await prisma.field.count({ where: { tableId } });

  const field = await prisma.field.create({
    data: {
      tableId,
      name: name || "New Field",
      type: type || "text",
      order,
      description: description || null,
      config: config ? JSON.stringify(config) : null,
    },
  });
  return NextResponse.json(field, { status: 201 });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ tableId: string }> }) {
  // Bulk reorder / visibility update: body = { fields: [{id, order?, visible?}] }
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tableId } = await params;
  const workspaceId = await getWorkspaceIdForTable(tableId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { fields } = await req.json();
  await prisma.$transaction(
    fields.map((f: { id: string; order?: number; visible?: boolean }) =>
      prisma.field.update({
        where: { id: f.id },
        data: { ...(f.order !== undefined ? { order: f.order } : {}), ...(f.visible !== undefined ? { visible: f.visible } : {}) },
      })
    )
  );
  return NextResponse.json({ ok: true });
}
