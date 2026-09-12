import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/permissions";

async function workspaceIdForView(viewId: string) {
  const view = await prisma.view.findUnique({
    where: { id: viewId },
    select: { table: { select: { base: { select: { workspaceId: true } } } } },
  });
  return view?.table.base.workspaceId ?? null;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ viewId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { viewId } = await params;
  const workspaceId = await workspaceIdForView(viewId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.config !== undefined) data.config = JSON.stringify(body.config);
  if (body.order !== undefined) data.order = body.order;
  if (body.isPublic !== undefined) data.isPublic = body.isPublic;

  const view = await prisma.view.update({ where: { id: viewId }, data });
  return NextResponse.json(view);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ viewId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { viewId } = await params;
  const workspaceId = await workspaceIdForView(viewId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.view.delete({ where: { id: viewId } });
  return NextResponse.json({ ok: true });
}
