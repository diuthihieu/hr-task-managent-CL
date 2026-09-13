// Turns raw Prisma Objective/KeyResult/KeyResultTask rows into the fully
// resolved ObjectiveRow/KeyResultRow shape the UI renders - joining in each
// linked task's own table fields to compute its progress, status label, due
// date and assignee. This is where "derived, not duplicated" progress data
// actually gets computed; see src/lib/okr-engine.ts for the pure math.

import { prisma } from "./prisma";
import { parseFieldConfig, SELECT_SINGLE_TYPES } from "./field-types";
import { computeKeyResultProgress, computeObjectiveProgress, resolveTaskProgress } from "./okr-engine";
import type { FieldRow, KeyResultRow, KeyResultTaskRow, ObjectiveRow, OkrUserLite } from "@/types";
import type { Prisma } from "@prisma/client";

const OBJECTIVE_INCLUDE = {
  team: true,
  owner: true,
  contributors: { include: { user: true } },
  keyResults: {
    orderBy: { order: "asc" as const },
    include: {
      owner: true,
      taskLinks: true,
    },
  },
} satisfies Prisma.ObjectiveInclude;

type ObjectiveWithIncludes = Prisma.ObjectiveGetPayload<{ include: typeof OBJECTIVE_INCLUDE }>;

function toUserLite(u: { id: string; name: string; avatarColor: string } | null | undefined): OkrUserLite | null {
  return u ? { id: u.id, name: u.name, avatarColor: u.avatarColor } : null;
}

export async function resolveObjectives(objectives: ObjectiveWithIncludes[]): Promise<ObjectiveRow[]> {
  const allTaskLinks = objectives.flatMap((o) => o.keyResults.flatMap((k) => k.taskLinks));
  const tableIds = [...new Set(allTaskLinks.map((t) => t.tableId))];
  const recordIds = allTaskLinks.map((t) => t.recordId);

  const [fields, tables, records, members] = await Promise.all([
    tableIds.length ? prisma.field.findMany({ where: { tableId: { in: tableIds } }, orderBy: { order: "asc" } }) : Promise.resolve([]),
    tableIds.length ? prisma.tableDef.findMany({ where: { id: { in: tableIds } }, select: { id: true, name: true, baseId: true } }) : Promise.resolve([]),
    recordIds.length ? prisma.record.findMany({ where: { id: { in: recordIds } } }) : Promise.resolve([]),
    objectives.length ? prisma.workspaceMember.findMany({ where: { workspaceId: objectives[0].workspaceId }, include: { user: true } }) : Promise.resolve([]),
  ]);

  const fieldsByTable = new Map<string, FieldRow[]>();
  for (const f of fields) {
    const list = fieldsByTable.get(f.tableId) ?? [];
    list.push(f as unknown as FieldRow);
    fieldsByTable.set(f.tableId, list);
  }
  const tableNameById = new Map(tables.map((t) => [t.id, t.name]));
  const tableBaseById = new Map(tables.map((t) => [t.id, t.baseId]));
  const recordById = new Map(records.map((r) => [r.id, r]));
  const memberById = new Map(members.map((m) => [m.userId, m.user]));

  function resolveTaskRow(link: (typeof allTaskLinks)[number]): KeyResultTaskRow | null {
    const record = recordById.get(link.recordId);
    if (!record) return null;
    const tableFields = fieldsByTable.get(link.tableId) ?? [];
    const data = JSON.parse(record.data || "{}") as Record<string, unknown>;

    const primaryField = tableFields.find((f) => f.isPrimary);
    const title = primaryField ? String(data[primaryField.id] ?? "") : "";

    const statusField = tableFields.find((f) => SELECT_SINGLE_TYPES.includes(f.type) && /status/i.test(f.name));
    const statusCfg = statusField ? parseFieldConfig(statusField.config) : null;
    const statusLabel = statusField ? statusCfg?.options?.find((o) => o.id === data[statusField.id])?.label ?? null : null;

    const dueDateField = tableFields.find((f) => f.type === "date" || f.type === "datetime");
    const dueDate = dueDateField ? (data[dueDateField.id] as string | null) ?? null : null;

    const personField = tableFields.find((f) => f.type === "person");
    const assigneeId = personField ? (data[personField.id] as string | null) : null;
    const assignee = assigneeId ? toUserLite(memberById.get(assigneeId) ?? null) : null;

    return {
      id: link.id,
      keyResultId: link.keyResultId,
      tableId: link.tableId,
      tableName: tableNameById.get(link.tableId) ?? "",
      baseId: tableBaseById.get(link.tableId) ?? "",
      recordId: link.recordId,
      weight: link.weight,
      title,
      status: statusLabel,
      progress: resolveTaskProgress(tableFields, data),
      dueDate,
      assignee,
    };
  }

  return objectives.map((o) => {
    const keyResults: KeyResultRow[] = o.keyResults.map((kr) => {
      const taskRows = kr.taskLinks.map(resolveTaskRow).filter((t): t is KeyResultTaskRow => t !== null);
      const progress = computeKeyResultProgress(
        { type: kr.type, startValue: kr.startValue, targetValue: kr.targetValue, currentValue: kr.currentValue, manualProgress: kr.manualProgress },
        taskRows.map((t) => ({ progress: t.progress, weight: t.weight }))
      );
      return {
        id: kr.id,
        objectiveId: kr.objectiveId,
        title: kr.title,
        owner: toUserLite(kr.owner),
        type: kr.type as KeyResultRow["type"],
        startValue: kr.startValue,
        targetValue: kr.targetValue,
        currentValue: kr.currentValue,
        unit: kr.unit,
        weight: kr.weight,
        manualProgress: kr.manualProgress,
        status: kr.status,
        order: kr.order,
        progress,
        tasks: taskRows,
      };
    });

    return {
      id: o.id,
      workspaceId: o.workspaceId,
      teamId: o.teamId,
      team: o.team ? { id: o.team.id, workspaceId: o.team.workspaceId, name: o.team.name, color: o.team.color } : null,
      title: o.title,
      description: o.description,
      owner: toUserLite(o.owner),
      cycleType: o.cycleType as ObjectiveRow["cycleType"],
      cycleLabel: o.cycleLabel,
      startDate: o.startDate ? o.startDate.toISOString() : null,
      endDate: o.endDate ? o.endDate.toISOString() : null,
      status: o.status as ObjectiveRow["status"],
      confidence: o.confidence,
      priority: o.priority as ObjectiveRow["priority"],
      contributors: o.contributors.map((c) => toUserLite(c.user)).filter((u): u is OkrUserLite => u !== null),
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
      keyResults,
      progress: computeObjectiveProgress(keyResults.map((k) => ({ progress: k.progress, weight: k.weight }))),
    };
  });
}

export const OBJECTIVE_INCLUDE_ARG = OBJECTIVE_INCLUDE;

/** Objectives where the user is owner, contributor, or the assignee of a task contributing to one of its Key Results. */
export async function getMyObjectiveRows(workspaceId: string, userId: string): Promise<ObjectiveRow[]> {
  const objectives = await prisma.objective.findMany({
    where: {
      workspaceId,
      OR: [{ ownerId: userId }, { contributors: { some: { userId } } }, { keyResults: { some: { ownerId: userId } } }],
    },
    include: OBJECTIVE_INCLUDE_ARG,
    orderBy: { createdAt: "desc" },
  });
  const directRows = await resolveObjectives(objectives);
  const matchedIds = new Set(directRows.map((r) => r.id));

  const others = await prisma.objective.findMany({
    where: { workspaceId, id: { notIn: [...matchedIds] } },
    include: OBJECTIVE_INCLUDE_ARG,
    orderBy: { createdAt: "desc" },
  });
  const otherRows = await resolveObjectives(others);
  const viaTask = otherRows.filter((o) => o.keyResults.some((k) => k.tasks.some((t) => t.assignee?.id === userId)));

  return [...directRows, ...viaTask];
}
