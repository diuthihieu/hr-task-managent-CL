import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership, getWorkspaceIdForObjective } from "@/lib/permissions";
import { resolveObjectives, OBJECTIVE_INCLUDE_ARG } from "@/lib/okr-resolver";

export async function POST(req: Request, { params }: { params: Promise<{ objectiveId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { objectiveId } = await params;
  const workspaceId = await getWorkspaceIdForObjective(objectiveId);
  if (!workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const order = await prisma.keyResult.count({ where: { objectiveId } });
  await prisma.keyResult.create({
    data: {
      objectiveId,
      title: body.title || "New Key Result",
      ownerId: body.ownerId || null,
      type: body.type || "task_based",
      startValue: body.startValue ?? 0,
      targetValue: body.targetValue ?? 100,
      currentValue: body.currentValue ?? 0,
      unit: body.unit || null,
      weight: body.weight ?? 1,
      manualProgress: body.manualProgress ?? null,
      status: body.status || "on_track",
      order,
    },
  });

  const objective = await prisma.objective.findUnique({ where: { id: objectiveId }, include: OBJECTIVE_INCLUDE_ARG });
  const [row] = await resolveObjectives([objective!]);
  return NextResponse.json(row, { status: 201 });
}
