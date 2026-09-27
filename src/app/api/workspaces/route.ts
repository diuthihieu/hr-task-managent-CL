import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser, route, readJson } from "@/lib/authz";
import { createWorkspace } from "@/lib/workspace-setup";
import { nameSchema } from "@/lib/validation";

/** Workspaces the caller can open (admins see all). */
export const GET = route(async () => {
  const user = await requireUser();
  if (user.systemRole === "ADMIN") {
    const all = await prisma.workspace.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
    return NextResponse.json(all.map((w) => ({ id: w.id, name: w.name, slug: w.slug, role: "owner" })));
  }
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id, workspace: { deletedAt: null } },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, slug: m.workspace.slug, role: m.role })));
});

const createSchema = z.object({ name: nameSchema, description: z.string().max(2000).nullable().optional() });

/** Only system admins create workspaces. */
export const POST = route(async (req) => {
  const admin = await requireAdmin();
  const body = createSchema.parse(await readJson(req));
  const workspace = await prisma.$transaction((tx) => createWorkspace(tx, { name: body.name, description: body.description, ownerId: admin.id }));
  return NextResponse.json({ id: workspace.id, name: workspace.name, slug: workspace.slug }, { status: 201 });
});
