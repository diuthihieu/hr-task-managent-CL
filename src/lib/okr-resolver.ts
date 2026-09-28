// Turns Objective / KeyResult rows (with their linked tasks, via
// tasks.key_result_id) into the resolved ObjectiveRow shape the UI renders.
// Progress is derived at read time; see okr-engine.ts for the math.

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { computeKeyResultProgress, computeObjectiveProgress, resolveTaskProgress } from "./okr-engine";
import { fromDateOnly } from "./task-grid";
import type { KeyResultRow, KeyResultTaskRow, ObjectiveRow, OkrUserLite } from "@/types";

const USER = { select: { id: true, name: true, avatarColor: true } } as const;

const TASK_INCLUDE = {
  status: { select: { name: true, category: true } },
  project: { select: { id: true, name: true } },
  assignees: { include: { user: USER }, take: 1, orderBy: { assignedAt: "asc" } },
} satisfies Prisma.TaskInclude;

export const OBJECTIVE_INCLUDE = {
  team: true,
  project: { select: { id: true, name: true, color: true } },
  parentKeyResult: { select: { id: true, title: true, objectiveId: true, objective: { select: { title: true } } } },
  tasks: {
    where: { deletedAt: null, keyResultId: null, project: { deletedAt: null } },
    orderBy: { createdAt: "asc" },
    include: TASK_INCLUDE,
  },
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
        include: TASK_INCLUDE,
      },
      childObjectives: { where: { deletedAt: null }, select: { id: true, title: true, parentKeyResultId: true, owner: USER } },
    },
  },
} satisfies Prisma.ObjectiveInclude;

type TaskWithIncludes = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

function toTaskRow(t: TaskWithIncludes, keyResultId: string | null): KeyResultTaskRow {
  return {
    id: t.id,
    keyResultId: keyResultId ?? "",
    projectId: t.project.id,
    projectName: t.project.name,
    taskId: t.id,
    weight: Number(t.okrWeight),
    title: t.title,
    status: t.status.name,
    progress: resolveTaskProgress({ progress: t.progress, statusCategory: t.status.category }),
    dueDate: fromDateOnly(t.dueDate),
    assignee: lite(t.assignees[0]?.user),
  };
}

type ObjectiveWithIncludes = Prisma.ObjectiveGetPayload<{ include: typeof OBJECTIVE_INCLUDE }>;

const lite = (u: { id: string; name: string; avatarColor: string } | null | undefined): OkrUserLite | null =>
  u ? { id: u.id, name: u.name, avatarColor: u.avatarColor } : null;

/**
 * `hidden` lists projects hidden from the viewer: their tasks still count
 * toward progress (the numbers stay truthful) but aren't listed by title.
 */
export function resolveObjectives(objectives: ObjectiveWithIncludes[], hidden: Set<string> = new Set()): ObjectiveRow[] {
  const shown = (rows: KeyResultTaskRow[], src: { id: string; projectId: string }[]) => rows.filter((r) => !hidden.has(src.find((t) => t.id === r.id)!.projectId));
  return objectives.map((o) => {
    const keyResults: KeyResultRow[] = o.keyResults.map((kr) => {
      const tasks: KeyResultTaskRow[] = kr.tasks.map((t) => toTaskRow(t, kr.id));
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
        tasks: shown(tasks, kr.tasks),
      };
    });

    const directTasks = o.tasks.map((t) => toTaskRow(t, null));
    const countedDirect = o.tasks.filter((t) => t.status.category !== "cancelled").map((t) => directTasks.find((r) => r.id === t.id)!);
    // With key results, progress rolls up from them; an objective set up
    // without key results takes the weighted progress of its linked tasks.
    const progress = keyResults.length
      ? computeObjectiveProgress(keyResults.map((k) => ({ progress: k.progress, weight: k.weight })))
      : computeKeyResultProgress({ type: "task_based", startValue: 0, targetValue: 100, currentValue: 0, manualProgress: null }, countedDirect.map((t) => ({ progress: t.progress, weight: t.weight })));
    return {
      id: o.id,
      workspaceId: o.workspaceId,
      projectId: o.projectId,
      project: o.project,
      parentObjectiveId: o.parentObjectiveId,
      parentKeyResult: o.parentKeyResult
        ? { id: o.parentKeyResult.id, title: o.parentKeyResult.title, objectiveId: o.parentKeyResult.objectiveId, objectiveTitle: o.parentKeyResult.objective.title }
        : null,
      tasks: shown(directTasks, o.tasks),
      childObjectives: o.keyResults.flatMap((kr) => kr.childObjectives.map((c) => ({ id: c.id, title: c.title, parentKeyResultId: kr.id, owner: lite(c.owner) }))),
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
      progress,
    };
  });
}

/** Objectives where the user is owner, contributor, KR owner, or assignee of a task contributing to the objective or one of its key results. */
export async function getMyObjectiveRows(workspaceId: string, userId: string, hidden: Set<string> = new Set()): Promise<ObjectiveRow[]> {
  const objectives = await prisma.objective.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      OR: [
        { ownerId: userId },
        { contributors: { some: { userId } } },
        { keyResults: { some: { deletedAt: null, ownerId: userId } } },
        { keyResults: { some: { deletedAt: null, tasks: { some: { deletedAt: null, assignees: { some: { userId } } } } } } },
        { tasks: { some: { deletedAt: null, assignees: { some: { userId } } } } },
      ],
      NOT: { projectId: { in: [...hidden] } },
    },
    include: OBJECTIVE_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return resolveObjectives(objectives, hidden);
}
