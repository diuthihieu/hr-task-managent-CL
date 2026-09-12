import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForDashboard } from "@/lib/permissions";

export async function POST(req: Request, { params }: { params: Promise<{ dashboardId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { dashboardId } = await params;
  const workspaceId = await getWorkspaceIdForDashboard(dashboardId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const count = await prisma.dashboardBlock.count({ where: { dashboardId } });
  // Stack new blocks below the tallest existing one so they never overlap.
  const existing = await prisma.dashboardBlock.findMany({ where: { dashboardId }, select: { y: true, h: true } });
  const maxY = existing.reduce((m, b) => Math.max(m, b.y + b.h), 0);

  const block = await prisma.dashboardBlock.create({
    data: {
      dashboardId,
      type: body.type,
      title: body.title || "",
      config: JSON.stringify(body.config || {}),
      x: 0,
      y: maxY,
      w: body.w ?? (body.type === "kpi" ? 3 : 6),
      h: body.h ?? (body.type === "kpi" ? 2 : 4),
      order: count,
    },
  });
  return NextResponse.json(block, { status: 201 });
}
