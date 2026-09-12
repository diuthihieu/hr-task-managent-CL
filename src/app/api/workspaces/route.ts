import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { nanoid } from "nanoid";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: (session.user as { id: string }).id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(memberships.map((m) => ({ ...m.workspace, role: m.role })));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { name } = await req.json();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const workspace = await prisma.workspace.create({
    data: {
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${nanoid(6)}`,
      members: { create: { userId: (session.user as { id: string }).id, role: "owner" } },
    },
  });
  return NextResponse.json(workspace, { status: 201 });
}
