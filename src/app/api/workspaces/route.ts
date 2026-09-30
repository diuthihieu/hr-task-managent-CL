import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, route, readJson, badRequest, supportAccess } from "@/lib/authz";
import { createWorkspace } from "@/lib/workspace-setup";
import { nameSchema } from "@/lib/validation";

/** Workspaces the caller can open (all of them only in break-glass support mode). */
export const GET = route(async () => {
  const user = await requireUser();
  if (supportAccess(user)) {
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

/** Any signed-in user can create a workspace and becomes its owner. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = createSchema.parse(await readJson(req));
  const count = await prisma.workspaceMember.count({ where: { userId: user.id, role: "owner", workspace: { deletedAt: null } } });
  if (count >= 50) throw badRequest("You already own 50 workspaces");
  const workspace = await prisma.$transaction((tx) => createWorkspace(tx, { name: body.name, description: body.description, ownerId: user.id }));
  return NextResponse.json({ id: workspace.id, name: workspace.name, slug: workspace.slug }, { status: 201 });
});
