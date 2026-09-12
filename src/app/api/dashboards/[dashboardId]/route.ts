import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForDashboard } from "@/lib/permissions";

export async function GET(_req: Request, { params }: { params: Promise<{ dashboardId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { dashboardId } = await params;
  const workspaceId = await getWorkspaceIdForDashboard(dashboardId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const dashboard = await prisma.dashboard.findUnique({
    where: { id: dashboardId },
    include: {
      blocks: { orderBy: { order: "asc" } },
      base: { select: { id: true, name: true, tables: { orderBy: { order: "asc" }, select: { id: true, name: true } } } },
    },
  });
  if (!dashboard) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(dashboard);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ dashboardId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { dashboardId } = await params;
  const workspaceId = await getWorkspaceIdForDashboard(dashboardId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.filters !== undefined) data.filters = JSON.stringify(body.filters);
  const dashboard = await prisma.dashboard.update({ where: { id: dashboardId }, data });
  return NextResponse.json(dashboard);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ dashboardId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { dashboardId } = await params;
  const workspaceId = await getWorkspaceIdForDashboard(dashboardId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership || !["owner", "admin", "editor"].includes(membership.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.dashboard.delete({ where: { id: dashboardId } });
  return NextResponse.json({ ok: true });
}
