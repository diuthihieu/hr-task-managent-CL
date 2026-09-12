import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const workspaceId = url.searchParams.get("workspaceId");
  if (!q || !workspaceId) return NextResponse.json({ bases: [], tables: [], records: [] });

  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: (session.user as { id: string }).id } },
  });
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const bases = await prisma.base.findMany({
    where: { workspaceId, name: { contains: q } },
    take: 5,
  });

  const tables = await prisma.tableDef.findMany({
    where: { base: { workspaceId }, name: { contains: q } },
    include: { base: { select: { id: true, name: true } } },
    take: 8,
  });

  const allTables = await prisma.tableDef.findMany({
    where: { base: { workspaceId } },
    include: { base: { select: { id: true, name: true } }, fields: { where: { isPrimary: true }, take: 1 } },
  });

  const records: Array<{ id: string; tableId: string; tableName: string; baseId: string; baseName: string; label: string }> = [];
  for (const t of allTables) {
    const primary = t.fields[0];
    if (!primary) continue;
    const rows = await prisma.record.findMany({ where: { tableId: t.id }, take: 200 });
    for (const r of rows) {
      const data = JSON.parse(r.data || "{}");
      const label = String(data[primary.id] ?? "");
      if (label.toLowerCase().includes(q)) {
        records.push({ id: r.id, tableId: t.id, tableName: t.name, baseId: t.base.id, baseName: t.base.name, label });
        if (records.length >= 15) break;
      }
    }
    if (records.length >= 15) break;
  }

  return NextResponse.json({ bases, tables, records });
}
