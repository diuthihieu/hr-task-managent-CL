import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, roleAtLeast } from "@/lib/permissions";

export async function GET(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const members = await prisma.workspaceMember.findMany({
    where: { workspaceId },
    include: { user: { select: { id: true, name: true, email: true, avatarColor: true } } },
  });
  const withRoles = new URL(req.url).searchParams.get("withRoles") === "1";
  if (withRoles) return NextResponse.json(members.map((m) => ({ ...m.user, role: m.role })));
  return NextResponse.json(members.map((m) => m.user));
}

export async function POST(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const actorMembership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!actorMembership || !roleAtLeast(actorMembership.role, "admin")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { email, role } = await req.json();
  if (!email?.trim()) return NextResponse.json({ error: "Email is required" }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user) return NextResponse.json({ error: "No user with that email has an account yet" }, { status: 404 });

  const existing = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: user.id } } });
  if (existing) return NextResponse.json({ error: "Already a member" }, { status: 400 });

  const member = await prisma.workspaceMember.create({
    data: { workspaceId, userId: user.id, role: role || "editor" },
    include: { user: { select: { id: true, name: true, email: true, avatarColor: true } } },
  });
  return NextResponse.json({ ...member.user, role: member.role }, { status: 201 });
}
