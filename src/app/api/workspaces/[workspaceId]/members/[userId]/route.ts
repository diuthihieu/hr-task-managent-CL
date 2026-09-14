import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, roleAtLeast } from "@/lib/permissions";

const VALID_ROLES = ["owner", "admin", "editor", "contributor", "viewer"];

export async function PATCH(req: Request, { params }: { params: Promise<{ workspaceId: string; userId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, userId: targetUserId } = await params;
  const actorId = (session.user as { id: string }).id;
  const actorMembership = await getMembership(actorId, workspaceId);
  if (!actorMembership || !roleAtLeast(actorMembership.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { role } = await req.json();
  if (!VALID_ROLES.includes(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });

  if (role !== "owner") {
    const target = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: targetUserId } } });
    if (target?.role === "owner") {
      const ownerCount = await prisma.workspaceMember.count({ where: { workspaceId, role: "owner" } });
      if (ownerCount <= 1) return NextResponse.json({ error: "A workspace needs at least one owner" }, { status: 400 });
    }
  }

  const updated = await prisma.workspaceMember.update({
    where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
    data: { role },
    include: { user: { select: { id: true, name: true, email: true, avatarColor: true } } },
  });
  return NextResponse.json({ ...updated.user, role: updated.role });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ workspaceId: string; userId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId, userId: targetUserId } = await params;
  const actorId = (session.user as { id: string }).id;
  const actorMembership = await getMembership(actorId, workspaceId);
  if (!actorMembership || !roleAtLeast(actorMembership.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const target = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: targetUserId } } });
  if (target?.role === "owner") {
    const ownerCount = await prisma.workspaceMember.count({ where: { workspaceId, role: "owner" } });
    if (ownerCount <= 1) return NextResponse.json({ error: "A workspace needs at least one owner" }, { status: 400 });
  }

  await prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId, userId: targetUserId } } });
  return NextResponse.json({ ok: true });
}
