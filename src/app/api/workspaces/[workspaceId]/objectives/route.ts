import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getMembership } from "@/lib/permissions";
import { resolveObjectives, getMyObjectiveRows, OBJECTIVE_INCLUDE_ARG } from "@/lib/okr-resolver";

export async function GET(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const userId = (session.user as { id: string }).id;
  const membership = await getMembership(userId, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const teamId = url.searchParams.get("teamId");
  const ownerId = url.searchParams.get("ownerId");
  const status = url.searchParams.get("status");
  const cycleType = url.searchParams.get("cycleType");
  const mine = url.searchParams.get("mine") === "1";

  let rows: Awaited<ReturnType<typeof resolveObjectives>>;
  if (mine) {
    rows = await getMyObjectiveRows(workspaceId, userId);
    if (teamId) rows = rows.filter((o) => o.teamId === teamId);
    if (status) rows = rows.filter((o) => o.status === status);
    if (cycleType) rows = rows.filter((o) => o.cycleType === cycleType);
  } else {
    const objectives = await prisma.objective.findMany({
      where: {
        workspaceId,
        ...(teamId ? { teamId } : {}),
        ...(ownerId ? { ownerId } : {}),
        ...(status ? { status } : {}),
        ...(cycleType ? { cycleType } : {}),
      },
      include: OBJECTIVE_INCLUDE_ARG,
      orderBy: { createdAt: "desc" },
    });
    rows = await resolveObjectives(objectives);
  }

  return NextResponse.json(rows);
}

export async function POST(req: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const membership = await getMembership((session.user as { id: string }).id, workspaceId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const objective = await prisma.objective.create({
    data: {
      workspaceId,
      teamId: body.teamId || null,
      title: body.title || "New Objective",
      description: body.description || null,
      ownerId: body.ownerId || null,
      cycleType: body.cycleType || "quarter",
      cycleLabel: body.cycleLabel || null,
      startDate: body.startDate ? new Date(body.startDate) : null,
      endDate: body.endDate ? new Date(body.endDate) : null,
      status: body.status || "not_started",
      confidence: body.confidence ?? 70,
      priority: body.priority || "medium",
      contributors: body.contributorIds?.length
        ? { create: (body.contributorIds as string[]).map((userId) => ({ userId })) }
        : undefined,
    },
    include: OBJECTIVE_INCLUDE_ARG,
  });
  const [row] = await resolveObjectives([objective]);
  return NextResponse.json(row, { status: 201 });
}
