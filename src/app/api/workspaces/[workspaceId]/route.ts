import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, roleAtLeast } from "@/lib/permissions";

export async function GET(_req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const userId = (session.user as { id: string }).id;
  const membership = await getMembership(userId, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ id: workspace.id, name: workspace.name, slug: workspace.slug, createdAt: workspace.createdAt.toISOString(), role: membership.role });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const userId = (session.user as { id: string }).id;
  const membership = await getMembership(userId, workspaceId);
  if (!membership || !roleAtLeast(membership.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  if (body.name !== undefined && body.name.trim()) data.name = body.name.trim();

  const workspace = await prisma.workspace.update({ where: { id: workspaceId }, data });
  return NextResponse.json({ id: workspace.id, name: workspace.name, slug: workspace.slug });
}
