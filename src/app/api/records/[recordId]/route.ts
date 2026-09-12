import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForRecord } from "@/lib/permissions";

function serialize(record: { id: string; tableId: string; data: string; order: number; createdById: string | null; createdAt: Date; updatedAt: Date }) {
  return {
    ...record,
    data: JSON.parse(record.data || "{}"),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { recordId } = await params;
  const workspaceId = await getWorkspaceIdForRecord(recordId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const existing = await prisma.record.findUnique({ where: { id: recordId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (body.data) {
    const merged = { ...JSON.parse(existing.data || "{}"), ...body.data };
    data.data = JSON.stringify(merged);
  }
  if (body.order !== undefined) data.order = body.order;

  const record = await prisma.record.update({ where: { id: recordId }, data });
  return NextResponse.json(serialize(record));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { recordId } = await params;
  const workspaceId = await getWorkspaceIdForRecord(recordId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.record.delete({ where: { id: recordId } });
  return NextResponse.json({ ok: true });
}
