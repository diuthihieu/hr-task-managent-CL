import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForTable } from "@/lib/permissions";

function serialize(record: { id: string; tableId: string; data: string; order: number; createdById: string | null; createdAt: Date; updatedAt: Date }) {
  return {
    ...record,
    data: JSON.parse(record.data || "{}"),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ tableId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tableId } = await params;
  const workspaceId = await getWorkspaceIdForTable(tableId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const records = await prisma.record.findMany({ where: { tableId }, orderBy: { order: "asc" } });
  return NextResponse.json(records.map(serialize));
}

export async function POST(req: Request, { params }: { params: Promise<{ tableId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tableId } = await params;
  const workspaceId = await getWorkspaceIdForTable(tableId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json().catch(() => ({}));
  const maxOrder = await prisma.record.aggregate({ where: { tableId }, _max: { order: true } });
  const data: Record<string, unknown> = { ...(body.data || {}) };

  const autoNumberFields = await prisma.field.findMany({ where: { tableId, type: "auto_number" } });
  if (autoNumberFields.length) {
    const count = await prisma.record.count({ where: { tableId } });
    for (const f of autoNumberFields) data[f.id] = count + 1;
  }

  const record = await prisma.record.create({
    data: {
      tableId,
      data: JSON.stringify(data),
      order: (maxOrder._max.order ?? 0) + 1,
      createdById: (session.user as { id: string }).id,
    },
  });
  return NextResponse.json(serialize(record), { status: 201 });
}
