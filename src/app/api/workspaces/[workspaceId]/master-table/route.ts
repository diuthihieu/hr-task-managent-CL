import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/permissions";

// Settings (Statuses/Priorities/Categories/Fields/Views) needs *a* task table
// to point its editors at, without hardcoding table ids per workspace. Per
// the "HR Operations = one master table" architecture, that's simply the
// first non-archived base's own (only) non-archived table.
export async function GET(_req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const base = await prisma.base.findFirst({
    where: { workspaceId, archived: false },
    orderBy: { order: "asc" },
    include: {
      tables: {
        where: { archived: false },
        orderBy: { order: "asc" },
        take: 1,
        include: { fields: { orderBy: { order: "asc" } }, views: { orderBy: { order: "asc" } } },
      },
    },
  });
  const table = base?.tables[0];
  if (!base || !table) return NextResponse.json({ error: "No task base found yet" }, { status: 404 });

  return NextResponse.json({
    baseId: base.id,
    baseName: base.name,
    tableId: table.id,
    tableName: table.name,
    fields: table.fields,
    views: table.views,
  });
}
