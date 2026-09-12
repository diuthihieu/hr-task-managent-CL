import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { nanoid } from "nanoid";

export async function POST(req: Request) {
  const { email, password, name } = await req.json();
  if (!email || !password || !name) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const colors = ["#6366f1", "#0ea5e9", "#f97316", "#22c55e", "#ec4899", "#8b5cf6"];
  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      avatarColor: colors[Math.floor(Math.random() * colors.length)],
    },
  });

  // First user: give them a personal workspace so the app is usable immediately.
  const workspace = await prisma.workspace.create({
    data: {
      name: `${name}'s Workspace`,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${nanoid(6)}`,
      members: { create: { userId: user.id, role: "owner" } },
    },
  });

  return NextResponse.json({ id: user.id, email: user.email, workspaceSlug: workspace.slug });
}
