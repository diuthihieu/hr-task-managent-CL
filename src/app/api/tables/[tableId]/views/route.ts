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
  const count = await prisma.view.count({ where: { tableId } });
  const view = await prisma.view.create({
    data: {
      tableId,
      name: body.name || "New View",
      type: body.type || "grid",
      config: JSON.stringify(body.config || {}),
      order: count,
    },
  });
  return NextResponse.json(view, { status: 201 });
}
