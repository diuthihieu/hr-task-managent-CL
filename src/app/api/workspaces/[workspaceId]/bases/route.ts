import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/permissions";

export async function GET(_req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const bases = await prisma.base.findMany({
    where: { workspaceId },
    orderBy: { order: "asc" },
    include: { tables: { orderBy: { order: "asc" }, select: { id: true, name: true, icon: true, order: true } } },
  });
  return NextResponse.json(bases);
}

export async function POST(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { name, icon, color } = await req.json();
  const count = await prisma.base.count({ where: { workspaceId } });
  const base = await prisma.base.create({
    data: {
      workspaceId,
      name: name || "Untitled Base",
      icon: icon || "Database",
      color: color || "#6366f1",
      order: count,
    },
  });
  return NextResponse.json(base, { status: 201 });
}
