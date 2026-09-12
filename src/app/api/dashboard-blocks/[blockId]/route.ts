import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForDashboardBlock } from "@/lib/permissions";

export async function PATCH(req: Request, { params }: { params: Promise<{ blockId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { blockId } = await params;
  const workspaceId = await getWorkspaceIdForDashboardBlock(blockId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.type !== undefined) data.type = body.type;
  if (body.config !== undefined) data.config = JSON.stringify(body.config);
  if (body.x !== undefined) data.x = body.x;
  if (body.y !== undefined) data.y = body.y;
  if (body.w !== undefined) data.w = body.w;
  if (body.h !== undefined) data.h = body.h;
  const block = await prisma.dashboardBlock.update({ where: { id: blockId }, data });
  return NextResponse.json(block);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ blockId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { blockId } = await params;
  const workspaceId = await getWorkspaceIdForDashboardBlock(blockId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.dashboardBlock.delete({ where: { id: blockId } });
  return NextResponse.json({ ok: true });
}
