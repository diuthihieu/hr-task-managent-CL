import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { resolveObjectives, getMyObjectiveRows, OBJECTIVE_INCLUDE } from "@/lib/okr-resolver";
import { assertObjectiveRefs } from "@/lib/okr-write";
import { objectiveSchema, dateOnlyToDate, lenientDateOnly } from "@/lib/validation";

type P = { workspaceId: string };

export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");
  const url = new URL(req.url);
  const teamId = url.searchParams.get("teamId");
  const ownerId = url.searchParams.get("ownerId");
  const status = url.searchParams.get("status") as Prisma.ObjectiveWhereInput["status"] | null;
  const cycleType = url.searchParams.get("cycleType") as Prisma.ObjectiveWhereInput["cycleType"] | null;

  let rows = url.searchParams.get("mine") === "1"
    ? await getMyObjectiveRows(workspaceId, user.id)
    : resolveObjectives(
        await prisma.objective.findMany({
          where: { workspaceId, deletedAt: null, ...(teamId ? { teamId } : {}), ...(ownerId ? { ownerId } : {}), ...(status ? { status } : {}), ...(cycleType ? { cycleType } : {}) },
          include: OBJECTIVE_INCLUDE,
          orderBy: { createdAt: "desc" },
        })
      );
  if (url.searchParams.get("mine") === "1") {
    if (teamId) rows = rows.filter((o) => o.teamId === teamId);
    if (status) rows = rows.filter((o) => o.status === status);
    if (cycleType) rows = rows.filter((o) => o.cycleType === cycleType);
  }
  return NextResponse.json(rows);
});

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "editor");
  const raw = await readJson<Record<string, unknown>>(req);
  const body = objectiveSchema.parse({ ...raw, startDate: lenientDateOnly(raw.startDate), endDate: lenientDateOnly(raw.endDate) });
  const objective = await prisma.$transaction(async (tx) => {
    await assertObjectiveRefs(tx, workspaceId, body);
    const o = await tx.objective.create({
      data: {
        workspaceId,
        title: body.title,
        description: body.description ?? null,
        teamId: body.teamId ?? null,
        parentObjectiveId: body.parentObjectiveId ?? null,
        ownerId: body.ownerId ?? null,
        cycleType: body.cycleType,
        cycleLabel: body.cycleLabel ?? null,
        startDate: dateOnlyToDate(body.startDate),
        endDate: dateOnlyToDate(body.endDate),
        status: body.status ?? "not_started",
        confidence: body.confidence,
        priority: body.priority,
        createdById: user.id,
        updatedById: user.id,
        contributors: body.contributorIds?.length ? { create: body.contributorIds.map((userId) => ({ userId })) } : undefined,
      },
      include: OBJECTIVE_INCLUDE,
    });
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "objective", entityId: o.id, action: "created", summary: `Created objective "${o.title}"` });
    return o;
  });
  return NextResponse.json(resolveObjectives([objective])[0], { status: 201 });
});
