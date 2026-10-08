import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, hiddenProjectIds, visibleProjectWhere } from "@/lib/authz";
import { resolveObjectives, OBJECTIVE_INCLUDE } from "@/lib/okr-resolver";
import { objectivePeriod, overlaps, rangeParams } from "@/lib/okr-period";

type P = { workspaceId: string };

export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { workspaceId } = await params;
  await requireWorkspaceRole(user, workspaceId, "viewer");

  const url = new URL(req.url);
  const ownerId = url.searchParams.get("ownerId");
  const status = url.searchParams.get("status") as Prisma.ObjectiveWhereInput["status"] | null;
  const cycleType = url.searchParams.get("cycleType") as Prisma.ObjectiveWhereInput["cycleType"] | null;
  const { from, to } = rangeParams(url);

  const objectives = await prisma.objective.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      OR: [{ projectId: null }, { project: { deletedAt: null, ...visibleProjectWhere(user) } }],
      ...(ownerId ? { ownerId } : {}),
      ...(status ? { status } : {}),
      ...(cycleType ? { cycleType } : {}),
    },
    include: OBJECTIVE_INCLUDE,
  });
  const rows = resolveObjectives(objectives, await hiddenProjectIds(user)).filter((o) => overlaps(objectivePeriod(o), from, to));

  const total = rows.length;
  const byStatus = { not_started: 0, on_track: 0, at_risk: 0, off_track: 0, completed: 0 } as Record<string, number>;
  for (const o of rows) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

  const avgProgress = total ? rows.reduce((s, o) => s + o.progress, 0) / total : 0;

  const projectMap = new Map<string, { name: string; sum: number; count: number }>();
  const ownerMap = new Map<string, { name: string; sum: number; count: number }>();
  let krTotal = 0;
  let krCompleted = 0;
  let tasksContributing = 0;
  for (const o of rows) {
    const projectKey = o.project?.id ?? "__workspace__";
    const pr = projectMap.get(projectKey) ?? { name: o.project?.name ?? "", sum: 0, count: 0 };
    pr.sum += o.progress;
    pr.count += 1;
    projectMap.set(projectKey, pr);

    const ownerKey = o.owner?.id ?? "__none__";
    const ownerName = o.owner?.name ?? "Unassigned";
    const ow = ownerMap.get(ownerKey) ?? { name: ownerName, sum: 0, count: 0 };
    ow.sum += o.progress;
    ow.count += 1;
    ownerMap.set(ownerKey, ow);

    for (const kr of o.keyResults) {
      krTotal += 1;
      if (kr.progress >= 100) krCompleted += 1;
      tasksContributing += kr.tasks.length;
    }
  }

  // "__workspace__" (name "") = workspace-level objectives; the client labels it.
  const progressByProject = [...projectMap.entries()].map(([id, v]) => ({ id, name: v.name, avgProgress: v.count ? v.sum / v.count : 0, count: v.count }));
  const progressByOwner = [...ownerMap.entries()].map(([id, v]) => ({ id, name: v.name, avgProgress: v.count ? v.sum / v.count : 0, count: v.count }));

  const now = Date.now();
  const upcomingDeadlines = rows
    .filter((o) => o.endDate && new Date(o.endDate).getTime() >= now && o.status !== "completed")
    .sort((a, b) => new Date(a.endDate!).getTime() - new Date(b.endDate!).getTime())
    .slice(0, 8)
    .map((o) => ({ id: o.id, title: o.title, endDate: o.endDate, progress: o.progress, status: o.status, projectName: o.project?.name ?? null }));

  return NextResponse.json({
    total,
    onTrack: byStatus.on_track,
    atRisk: byStatus.at_risk,
    offTrack: byStatus.off_track,
    completed: byStatus.completed,
    notStarted: byStatus.not_started,
    avgProgress,
    objectivesByStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
    progressByProject,
    progressByOwner,
    keyResultTotal: krTotal,
    keyResultCompleted: krCompleted,
    tasksContributing,
    upcomingDeadlines,
  });
});
