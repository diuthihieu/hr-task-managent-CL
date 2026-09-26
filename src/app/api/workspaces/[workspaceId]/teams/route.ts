import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson } from "@/lib/authz";
import { colorSchema } from "@/lib/validation";

type P = { workspaceId: string };

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const teams = await prisma.team.findMany({ where: { workspaceId }, orderBy: { name: "asc" } });
  return NextResponse.json(teams.map((t) => ({ id: t.id, workspaceId: t.workspaceId, name: t.name, color: t.color })));
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "editor");
  const body = z.object({ name: z.string().trim().min(1).max(120), color: colorSchema.optional() }).parse(await readJson(req));
  const t = await prisma.team.create({ data: { workspaceId, name: body.name, color: body.color, createdById: user.id } });
  return NextResponse.json({ id: t.id, workspaceId: t.workspaceId, name: t.name, color: t.color }, { status: 201 });
});
