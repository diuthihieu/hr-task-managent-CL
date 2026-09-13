import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForObjective } from "@/lib/permissions";
import { resolveObjectives, OBJECTIVE_INCLUDE_ARG } from "@/lib/okr-resolver";

export async function GET(_req: Request, { params }: { params: Promise<{ objectiveId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { objectiveId } = await params;
  const workspaceId = await getWorkspaceIdForObjective(objectiveId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const objective = await prisma.objective.findUnique({ where: { id: objectiveId }, include: OBJECTIVE_INCLUDE_ARG });
  if (!objective) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const [row] = await resolveObjectives([objective]);
  return NextResponse.json(row);
}

export async function PATCH(req: Request, { params }: { params: Promise<{ objectiveId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { objectiveId } = await params;
  const workspaceId = await getWorkspaceIdForObjective(objectiveId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  for (const key of ["title", "description", "cycleType", "cycleLabel", "status", "priority"] as const) {
    if (body[key] !== undefined) data[key] = body[key];
  }
  if (body.teamId !== undefined) data.teamId = body.teamId || null;
  if (body.ownerId !== undefined) data.ownerId = body.ownerId || null;
  if (body.confidence !== undefined) data.confidence = body.confidence;
  if (body.startDate !== undefined) data.startDate = body.startDate ? new Date(body.startDate) : null;
  if (body.endDate !== undefined) data.endDate = body.endDate ? new Date(body.endDate) : null;

  if (body.contributorIds !== undefined) {
    await prisma.objectiveContributor.deleteMany({ where: { objectiveId } });
    if ((body.contributorIds as string[]).length) {
      await prisma.objectiveContributor.createMany({
        data: (body.contributorIds as string[]).map((userId) => ({ objectiveId, userId })),
      });
    }
  }

  const objective = await prisma.objective.update({ where: { id: objectiveId }, data, include: OBJECTIVE_INCLUDE_ARG });
  const [row] = await resolveObjectives([objective]);
  return NextResponse.json(row);
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ objectiveId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { objectiveId } = await params;
  const workspaceId = await getWorkspaceIdForObjective(objectiveId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await prisma.objective.delete({ where: { id: objectiveId } });
  return NextResponse.json({ ok: true });
}
