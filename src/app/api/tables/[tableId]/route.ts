import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForTable } from "@/lib/permissions";

export async function GET(_req: Request, { params }: { params: Promise<{ tableId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tableId } = await params;
  const workspaceId = await getWorkspaceIdForTable(tableId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const table = await prisma.tableDef.findUnique({
    where: { id: tableId },
    include: {
      fields: { orderBy: { order: "asc" } },
      views: { orderBy: { order: "asc" } },
      base: { select: { id: true, name: true, workspaceId: true, workspace: { select: { slug: true, name: true } } } },
    },
  });
  if (!table) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true, avatarColor: true } } },
  });

  return NextResponse.json({
    ...table,
    members: members.map((m) => m.user),
    myRole: membership.role,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ tableId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tableId } = await params;
  const workspaceId = await getWorkspaceIdForTable(tableId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json();
  const table = await prisma.tableDef.update({ where: { id: tableId }, data: { name: body.name } });
  return NextResponse.json(table);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ tableId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tableId } = await params;
  const workspaceId = await getWorkspaceIdForTable(tableId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership || !["owner", "admin", "editor"].includes(membership.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.tableDef.delete({ where: { id: tableId } });
  return NextResponse.json({ ok: true });
}
