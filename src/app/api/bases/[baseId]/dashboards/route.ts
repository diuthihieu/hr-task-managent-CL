import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForBase } from "@/lib/permissions";

export async function GET(_req: Request, { params }: { params: Promise<{ baseId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { baseId } = await params;
  const workspaceId = await getWorkspaceIdForBase(baseId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const dashboards = await prisma.dashboard.findMany({
    where: { baseId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, baseId: true },
  });
  return NextResponse.json(dashboards);
}

export async function POST(req: Request, { params }: { params: Promise<{ baseId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { baseId } = await params;
  const workspaceId = await getWorkspaceIdForBase(baseId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { name } = await req.json().catch(() => ({}));
  const dashboard = await prisma.dashboard.create({
    data: { baseId, name: name || "New Dashboard" },
  });
  return NextResponse.json(dashboard, { status: 201 });
}
