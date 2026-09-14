import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/permissions";

// Best-effort human label for the audited object - looks up the record's
// primary field value so "record cmxyz..." reads as "Prepare payroll
// reconciliation" instead of a bare id. Falls back to the id if the record
// (or its table) was since deleted.
async function resolveLabel(objectType: string, objectId: string): Promise<string | null> {
  if (objectType !== "record") return null;
  const record = await prisma.record.findUnique({ where: { id: objectId }, select: { data: true, table: { select: { fields: { where: { isPrimary: true }, take: 1 } } } } });
  if (!record) return null;
  const primary = record.table.fields[0];
  if (!primary) return null;
  const data = JSON.parse(record.data || "{}");
  const value = data[primary.id];
  return typeof value === "string" && value.trim() ? value : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 100, 200);

  const entries = await prisma.auditLog.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { user: { select: { id: true, name: true, avatarColor: true } } },
  });

  const rows = await Promise.all(
    entries.map(async (e) => ({
      id: e.id,
      action: e.action,
      objectType: e.objectType,
      objectId: e.objectId,
      label: await resolveLabel(e.objectType, e.objectId),
      user: e.user ? { id: e.user.id, name: e.user.name, avatarColor: e.user.avatarColor } : null,
      createdAt: e.createdAt.toISOString(),
    }))
  );

  return NextResponse.json(rows);
}
