// Turns Objective / KeyResult rows (with their linked tasks, via
// tasks.key_result_id) into the resolved ObjectiveRow shape the UI renders.
// Progress is derived at read time; see okr-engine.ts for the math.

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { computeKeyResultProgress, computeObjectiveProgress, resolveTaskProgress } from "./okr-engine";
import { fromDateOnly } from "./task-grid";
import type { KeyResultRow, KeyResultTaskRow, ObjectiveRow, OkrUserLite } from "@/types";

const USER = { select: { id: true, name: true, avatarColor: true } } as const;

export const OBJECTIVE_INCLUDE = {
  team: true,
  owner: USER,
  contributors: { include: { user: USER } },
  keyResults: {
    where: { deletedAt: null },
    orderBy: { sortOrder: "asc" },
    include: {
      owner: USER,
      tasks: {
        where: { deletedAt: null, project: { deletedAt: null } },
        orderBy: { createdAt: "asc" },
        include: {
          status: { select: { name: true, category: true } },
          project: { select: { id: true, name: true } },
          assignees: { include: { user: USER }, take: 1, orderBy: { assignedAt: "asc" } },
        },
      },
    },
  },
} satisfies Prisma.ObjectiveInclude;

type ObjectiveWithIncludes = Prisma.ObjectiveGetPayload<{ include: typeof OBJECTIVE_INCLUDE }>;

const lite = (u: { id: string; name: string; avatarColor: string } | null | undefined): OkrUserLite | null =>
  u ? { id: u.id, name: u.name, avatarColor: u.avatarColor } : null;

export function resolveObjectives(objectives: ObjectiveWithIncludes[]): ObjectiveRow[] {
  return objectives.map((o) => {
    const keyResults: KeyResultRow[] = o.keyResults.map((kr) => {
      const tasks: KeyResultTaskRow[] = kr.tasks.map((t) => ({
        id: t.id,
        keyResultId: kr.id,
        projectId: t.project.id,
        projectName: t.project.name,
        taskId: t.id,
        weight: Number(t.okrWeight),
        title: t.title,
        status: t.status.name,
        progress: resolveTaskProgress({ progress: t.progress, statusCategory: t.status.category }),
        dueDate: fromDateOnly(t.dueDate),
        assignee: lite(t.assignees[0]?.user),
      }));
      // Cancelled tasks no longer count toward the key result.
      const counted = kr.tasks.filter((t) => t.status.category !== "cancelled").map((t) => tasks.find((r) => r.id === t.id)!);
      const progress = computeKeyResultProgress(
        {
          type: kr.type,
          startValue: Number(kr.startValue),
          targetValue: Number(kr.targetValue),
          currentValue: Number(kr.currentValue),
          manualProgress: kr.manualProgress === null ? null : Number(kr.manualProgress),
        },
        counted.map((t) => ({ progress: t.progress, weight: t.weight }))
      );
      return {
        id: kr.id,
        objectiveId: kr.objectiveId,
        title: kr.title,
        owner: lite(kr.owner),
        type: kr.type,
        startValue: Number(kr.startValue),
        targetValue: Number(kr.targetValue),
        currentValue: Number(kr.currentValue),
        unit: kr.unit,
        weight: Number(kr.weight),
        manualProgress: kr.manualProgress === null ? null : Number(kr.manualProgress),
        status: kr.status,
        order: kr.sortOrder,
        progress,
        tasks,
      };
    });

    return {
      id: o.id,
      workspaceId: o.workspaceId,
      teamId: o.teamId,
      team: o.team ? { id: o.team.id, workspaceId: o.team.workspaceId, name: o.team.name, color: o.team.color } : null,
      title: o.title,
      description: o.description,
      owner: lite(o.owner),
      cycleType: o.cycleType,
      cycleLabel: o.cycleLabel,
      startDate: fromDateOnly(o.startDate),
      endDate: fromDateOnly(o.endDate),
      status: o.status,
      confidence: o.confidence,
      priority: o.priority,
      contributors: o.contributors.map((c) => lite(c.user)).filter((u): u is OkrUserLite => u !== null),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      keyResults,
      progress: computeObjectiveProgress(keyResults.map((k) => ({ progress: k.progress, weight: k.weight }))),
    };
  });
}

/** Objectives where the user is owner, contributor, KR owner, or assignee of a task contributing to one of its key results. */
export async function getMyObjectiveRows(workspaceId: string, userId: string): Promise<ObjectiveRow[]> {
  const objectives = await prisma.objective.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      OR: [
        { ownerId: userId },
        { contributors: { some: { userId } } },
        { keyResults: { some: { deletedAt: null, ownerId: userId } } },
        { keyResults: { some: { deletedAt: null, tasks: { some: { deletedAt: null, assignees: { some: { userId } } } } } } },
      ],
    },
    include: OBJECTIVE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return resolveObjectives(objectives);
}
