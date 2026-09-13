import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForKeyResult } from "@/lib/permissions";
import { resolveObjectives, OBJECTIVE_INCLUDE_ARG } from "@/lib/okr-resolver";

export async function PATCH(req: Request, { params }: { params: Promise<{ keyResultId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { keyResultId } = await params;
  const workspaceId = await getWorkspaceIdForKeyResult(keyResultId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  for (const key of ["title", "type", "unit", "status"] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (body.ownerId !== undefined) data.ownerId = body.ownerId || null;
  for (const key of ["startValue", "targetValue", "currentValue", "weight", "manualProgress", "order"] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }

  const kr = await prisma.keyResult.update({ where: { id: keyResultId }, data });
  const objective = await prisma.objective.findUnique({ where: { id: kr.objectiveId }, include: OBJECTIVE_INCLUDE_ARG });
  const [row] = await resolveObjectives([objective!]);
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ keyResultId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { keyResultId } = await params;
  const workspaceId = await getWorkspaceIdForKeyResult(keyResultId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const kr = await prisma.keyResult.delete({ where: { id: keyResultId } });
  const objective = await prisma.objective.findUnique({ where: { id: kr.objectiveId }, include: OBJECTIVE_INCLUDE_ARG });
  const [row] = await resolveObjectives([objective!]);
  return NextResponse.json(row);
}
