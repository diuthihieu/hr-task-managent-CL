// Adapter between the normalized task schema and the generic field/record
// shape the view components (grid, kanban, calendar, gantt, gallery, form,
// eisenhower, dashboards, export) consume.
//
// - Read:  tasks + statuses + categories + custom fields  ->  FieldRow[] / RecordRow[]
// - Write: RecordRow-style `{ [fieldId]: value }` patch   ->  typed column
//          updates, assignee/dependency join rows and custom-field value rows,
//          all validated and written in the caller's transaction.
//
// System field ids are stable strings (`sys_*`); custom field ids are uuids.

import { Prisma, type CustomFieldType } from "@prisma/client";
import { prisma } from "./prisma";
import { badRequest } from "./http-errors";
import { IMPORTANCE_OPTIONS, URGENCY_OPTIONS, PRIORITY_OPTIONS_DEFAULT } from "./field-types";
import type { FieldRow, RecordRow } from "@/types";
import { makeT, type MessageKey, type TFunction } from "./i18n/core";
import { objectiveVisibility } from "./okr-write";

type Tx = Prisma.TransactionClient;

export const SYS = {
  title: "sys_title",
  status: "sys_status",
  assignees: "sys_assignees",
  reportTo: "sys_report_to",
  priority: "sys_priority",
  category: "sys_category",
  startDate: "sys_start_date",
  dueDate: "sys_due_date",
  progress: "sys_progress",
  estimate: "sys_estimate",
  actual: "sys_actual",
  keyResult: "sys_key_result",
  objective: "sys_objective",
  attachments: "sys_attachments",
  importance: "sys_importance",
  urgency: "sys_urgency",
  dependsOn: "sys_depends_on",
  parent: "sys_parent",
  description: "sys_description",
  createdAt: "sys_created_at",
  updatedAt: "sys_updated_at",
  createdBy: "sys_created_by",
  /** Not a grid column: { freq: "daily" | "weekly" | "monthly", interval: n } or null. */
  recurrence: "sys_recurrence",
} as const;

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;

const READ_ONLY_SYS = new Set<string>([SYS.createdAt, SYS.updatedAt, SYS.createdBy, SYS.attachments]);

/** Value of the "Objective" task field: `kr:<id>` (key result, objective implied) or `obj:<id>` (objective only). */
export function okrTargetToken(task: { keyResultId: string | null; objectiveId: string | null }): string | null {
  if (task.keyResultId) return `kr:${task.keyResultId}`;
  if (task.objectiveId) return `obj:${task.objectiveId}`;
  return null;
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

/** `@db.Date` columns: accept "YYYY-MM-DD" or an ISO string, store as UTC midnight. */
export function toDateOnly(v: unknown, label: string): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string" || !DATE_RE.test(v)) throw badRequest(`${label} must be a date (YYYY-MM-DD)`);
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime()) || date.getUTCMonth() !== m - 1) throw badRequest(`${label} is not a valid date`);
  return date;
}

export function fromDateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function toTimestamp(v: unknown, label: string): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") throw badRequest(`${label} must be a date/time`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`${label} is not a valid date/time`);
  return d;
}

function toNumber(v: unknown, label: string): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw badRequest(`${label} must be a number`);
  return n;
}

function toIdOrNull(v: unknown, label: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") throw badRequest(`${label} must be an id`);
  return v;
}

function toIdArray(v: unknown, label: string): string[] {
  if (v === null || v === undefined || v === "") return [];
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw badRequest(`${label} must be a list of ids`);
  return [...new Set(v as string[])];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID_RE.test(s);

function assertUuids(ids: string[], label: string) {
  for (const id of ids) if (!isUuid(id)) throw badRequest(`${label}: invalid id`);
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

const TASK_INCLUDE = {
  assignees: { select: { userId: true } },
  reportTo: { select: { userId: true } },
  dependencies: { select: { dependsOnTaskId: true } },
  customValues: true,
  attachments: { where: { deletedAt: null }, select: { id: true, fileName: true, contentType: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

interface ProjectMeta {
  project: { id: string; workspaceId: string; name: string };
  statuses: { id: string; name: string; color: string; category: string; isDefault: boolean }[];
  categories: { id: string; name: string; color: string }[];
  customFields: Prisma.CustomFieldGetPayload<{ include: { options: true } }>[];
  /** Objectives set up in this project; the "Objective" field only appears when there is at least one. */
  objectives: { id: string; title: string; keyResults: { id: string; title: string }[] }[];
}

export async function loadProjectMeta(projectId: string, db: Tx | typeof prisma = prisma): Promise<ProjectMeta | null> {
  const project = await db.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, workspaceId: true, name: true } });
  if (!project) return null;
  const [statuses, categories, customFields, objectives] = await Promise.all([
    db.status.findMany({ where: { workspaceId: project.workspaceId }, orderBy: { sortOrder: "asc" } }),
    db.category.findMany({ where: { projectId }, orderBy: { sortOrder: "asc" } }),
    db.customField.findMany({
      where: { projectId, deletedAt: null },
      include: { options: { orderBy: { sortOrder: "asc" } } },
      orderBy: { sortOrder: "asc" },
    }),
    db.objective.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, title: true, keyResults: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" }, select: { id: true, title: true } } },
    }),
  ]);
  return { project, statuses, categories, customFields, objectives };
}

function sysField(projectId: string, id: string, name: string, type: string, order: number, extra: Partial<FieldRow> = {}): FieldRow {
  return { id, projectId, name, type, config: null, order, isPrimary: false, visible: true, description: null, defaultValue: null, system: true, ...extra };
}

export function buildFields(meta: ProjectMeta, t: TFunction = makeT("en")): FieldRow[] {
  const pid = meta.project.id;
  const n = (id: string) => t(`field.${id}` as MessageKey);
  const opts = (o: object) => JSON.stringify(o);
  const sys: FieldRow[] = [
    sysField(pid, SYS.title, n(SYS.title), "text", 0, { isPrimary: true }),
    sysField(pid, SYS.status, n(SYS.status), "status", 1, {
      config: opts({ options: meta.statuses.map((s) => ({ id: s.id, label: s.name, color: s.color, category: s.category })) }),
    }),
    sysField(pid, SYS.assignees, n(SYS.assignees), "people", 2),
    sysField(pid, SYS.reportTo, n(SYS.reportTo), "people", 2.5, { description: t("fieldHint.sys_report_to") }),
    sysField(pid, SYS.priority, n(SYS.priority), "single_select", 3, { config: opts({ options: PRIORITY_OPTIONS_DEFAULT }) }),
    sysField(pid, SYS.category, n(SYS.category), "single_select", 4, {
      config: opts({ options: meta.categories.map((c) => ({ id: c.id, label: c.name, color: c.color })) }),
    }),
    sysField(pid, SYS.startDate, n(SYS.startDate), "date", 5),
    sysField(pid, SYS.dueDate, n(SYS.dueDate), "date", 6),
    sysField(pid, SYS.progress, n(SYS.progress), "progress", 7),
    sysField(pid, SYS.estimate, n(SYS.estimate), "number", 8, { config: opts({ precision: 2 }) }),
    sysField(pid, SYS.actual, n(SYS.actual), "number", 8.5, { config: opts({ precision: 2 }), description: t("fieldHint.sys_actual") }),
    ...(meta.objectives.length
      ? [sysField(pid, SYS.objective, n(SYS.objective), "okr_target", 9, { config: opts({ objectives: meta.objectives }) })]
      : []),
    sysField(pid, SYS.importance, n(SYS.importance), "importance", 10, { config: opts({ options: IMPORTANCE_OPTIONS }) }),
    sysField(pid, SYS.urgency, n(SYS.urgency), "urgency", 11, { config: opts({ options: URGENCY_OPTIONS }) }),
    sysField(pid, SYS.dependsOn, n(SYS.dependsOn), "link", 12, { config: opts({ linkProjectId: pid }), description: t("fieldHint.sys_depends_on") }),
    sysField(pid, SYS.parent, n(SYS.parent), "link", 13, { config: opts({ linkProjectId: pid, maxLinks: 1 }), description: t("fieldHint.sys_parent") }),
    sysField(pid, SYS.description, n(SYS.description), "long_text", 14),
    sysField(pid, SYS.attachments, n(SYS.attachments), "task_attachments", 15, { readOnly: true }),
  ];
  const custom: FieldRow[] = meta.customFields.map((f, i) => {
    const settings = (f.settings ?? {}) as Record<string, unknown>;
    const config: Record<string, unknown> = { ...settings };
    if (f.type === "single_select" || f.type === "multi_select") {
      config.options = f.options.map((o) => ({ id: o.id, label: o.label, color: o.color }));
    }
    return {
      id: f.id,
      projectId: pid,
      name: f.name,
      type: f.type,
      config: JSON.stringify(config),
      order: 100 + i,
      isPrimary: false,
      visible: true,
      description: f.description,
      defaultValue: null,
      isRequired: f.isRequired,
    };
  });
  const tail: FieldRow[] = [
    sysField(pid, SYS.createdAt, n(SYS.createdAt), "created_time", 1000, { readOnly: true }),
    sysField(pid, SYS.updatedAt, n(SYS.updatedAt), "modified_time", 1001, { readOnly: true }),
    sysField(pid, SYS.createdBy, n(SYS.createdBy), "created_by", 1002, { readOnly: true }),
  ];
  return [...sys, ...custom, ...tail];
}

function customValueOut(type: CustomFieldType, v: TaskWithRelations["customValues"][number]): unknown {
  switch (type) {
    case "number":
    case "currency":
    case "percent":
    case "rating":
      return v.valueNumber === null ? null : Number(v.valueNumber);
    case "checkbox":
      return v.valueBool ?? false;
    case "date":
      return v.valueDate ? v.valueDate.toISOString().slice(0, 10) : null;
    case "datetime":
      return v.valueDate ? v.valueDate.toISOString() : null;
    case "single_select":
      return v.valueOptionId;
    case "multi_select":
      return v.valueOptionIds;
    case "person":
      return v.valueUserId;
    case "formula":
      return null;
    default:
      return v.valueText;
  }
}

export function toRecord(task: TaskWithRelations, fieldTypes: Map<string, CustomFieldType>): RecordRow {
  const data: Record<string, unknown> = {
    [SYS.title]: task.title,
    [SYS.status]: task.statusId,
    [SYS.assignees]: task.assignees.map((a) => a.userId),
    [SYS.reportTo]: task.reportTo.map((r) => r.userId),
    [SYS.priority]: task.priority,
    [SYS.category]: task.categoryId,
    [SYS.startDate]: fromDateOnly(task.startDate),
    [SYS.dueDate]: fromDateOnly(task.dueDate),
    [SYS.progress]: task.progress,
    [SYS.estimate]: task.estimateMinutes === null ? null : Math.round((task.estimateMinutes / 60) * 100) / 100,
    [SYS.actual]: task.actualMinutes === null ? null : Math.round((task.actualMinutes / 60) * 100) / 100,
    [SYS.objective]: okrTargetToken(task),
    [SYS.importance]: task.importance,
    [SYS.urgency]: task.urgency,
    [SYS.dependsOn]: task.dependencies.map((d) => d.dependsOnTaskId),
    [SYS.parent]: task.parentTaskId ? [task.parentTaskId] : [],
    [SYS.description]: task.description,
    [SYS.attachments]: task.attachments.map((a) => ({ id: a.id, name: a.fileName, type: a.contentType })),
    [SYS.createdAt]: task.createdAt.toISOString(),
    [SYS.updatedAt]: task.updatedAt.toISOString(),
    [SYS.createdBy]: task.createdById,
  };
  for (const v of task.customValues) {
    const type = fieldTypes.get(v.customFieldId);
    if (type) data[v.customFieldId] = customValueOut(type, v);
  }
  return {
    id: task.id,
    projectId: task.projectId,
    data,
    order: task.sortOrder,
    createdById: task.createdById,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

export async function loadProjectGrid(projectId: string) {
  const meta = await loadProjectMeta(projectId);
  if (!meta) return null;
  const tasks = await prisma.task.findMany({
    where: { projectId, deletedAt: null },
    include: TASK_INCLUDE,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const types = new Map(meta.customFields.map((f) => [f.id, f.type]));
  return { meta, fields: buildFields(meta), records: tasks.map((t) => toRecord(t, types)) };
}

export async function loadTaskRecord(taskId: string, db: Tx | typeof prisma = prisma): Promise<RecordRow | null> {
  const task = await db.task.findFirst({ where: { id: taskId, deletedAt: null }, include: TASK_INCLUDE });
  if (!task) return null;
  const fields = await db.customField.findMany({ where: { projectId: task.projectId }, select: { id: true, type: true } });
  return toRecord(task, new Map(fields.map((f) => [f.id, f.type])));
}

// ---------------------------------------------------------------------------
// Write side
// ---------------------------------------------------------------------------

export interface PatchResult {
  changes: Record<string, { from: unknown; to: unknown }>;
  statusChanged: boolean;
  /** Name of the new status when it changed (for notifications). */
  newStatusName?: string;
  assigned: string[];
  unassigned: string[];
  /** Users newly added to "Report to". */
  reportAdded: string[];
}

/** Walks the dependency graph from each prerequisite; rejects if it reaches `taskId`. */
async function assertNoDependencyCycle(tx: Tx, taskId: string, dependsOn: string[]) {
  const seen = new Set<string>();
  let frontier = [...dependsOn];
  while (frontier.length) {
    if (frontier.includes(taskId)) throw badRequest("Dependency would create a cycle");
    frontier = frontier.filter((id) => !seen.has(id));
    frontier.forEach((id) => seen.add(id));
    if (!frontier.length) break;
    const next = await tx.taskDependency.findMany({ where: { taskId: { in: frontier } }, select: { dependsOnTaskId: true } });
    frontier = next.map((n) => n.dependsOnTaskId);
  }
}

async function assertNoParentCycle(tx: Tx, taskId: string, parentId: string) {
  let cursor: string | null = parentId;
  for (let depth = 0; cursor && depth < 100; depth++) {
    if (cursor === taskId) throw badRequest("A task cannot be its own ancestor");
    const row: { parentTaskId: string | null } | null = await tx.task.findUnique({ where: { id: cursor }, select: { parentTaskId: true } });
    cursor = row?.parentTaskId ?? null;
  }
}

/**
 * Applies a `{ fieldId: value }` patch to one task inside `tx`. Unknown field
 * ids and read-only fields are rejected rather than silently ignored.
 */
export async function applyTaskPatch(
  tx: Tx,
  opts: { taskId: string; projectId: string; workspaceId: string; actorId: string | null; data: Record<string, unknown>; isNew?: boolean }
): Promise<PatchResult> {
  const { taskId, projectId, workspaceId, actorId, data } = opts;
  const before = await tx.task.findUniqueOrThrow({ where: { id: taskId }, include: TASK_INCLUDE });
  const update: Prisma.TaskUncheckedUpdateInput = {};
  const changes: PatchResult["changes"] = {};
  const result: PatchResult = { changes, statusChanged: false, assigned: [], unassigned: [], reportAdded: [] };
  const record = (key: string, from: unknown, to: unknown) => {
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
  };

  const customIds = Object.keys(data).filter((k) => !k.startsWith("sys_"));
  const customFields = customIds.length
    ? await tx.customField.findMany({ where: { id: { in: customIds.filter(isUuid) }, projectId, deletedAt: null }, include: { options: { select: { id: true } } } })
    : [];
  const customById = new Map(customFields.map((f) => [f.id, f]));

  for (const [key, value] of Object.entries(data)) {
    if (READ_ONLY_SYS.has(key)) throw badRequest(`${key} is read-only`);
    switch (key) {
      case SYS.title: {
        const title = typeof value === "string" ? value.trim() : "";
        if (!title) throw badRequest("Task name is required");
        if (title.length > 500) throw badRequest("Task name is too long (max 500)");
        update.title = title;
        record("title", before.title, title);
        break;
      }
      case SYS.description: {
        if (value !== null && typeof value !== "string") throw badRequest("Description must be text");
        update.description = (value as string | null) || null;
        record("description", before.description, update.description);
        break;
      }
      case SYS.status: {
        const statusId = toIdOrNull(value, "Status");
        if (!statusId || !isUuid(statusId)) throw badRequest("Status is required");
        const status = await tx.status.findFirst({ where: { id: statusId, workspaceId }, select: { id: true, category: true, name: true } });
        if (!status) throw badRequest("Unknown status");
        update.statusId = statusId;
        if (statusId !== before.statusId) {
          result.statusChanged = true;
          result.newStatusName = status.name;
          update.completedAt = status.category === "done" ? new Date() : null;
          if (status.category === "done") update.progress = 100;
        }
        record("status", before.statusId, statusId);
        break;
      }
      case SYS.priority: {
        if (!PRIORITIES.includes(value as (typeof PRIORITIES)[number])) throw badRequest("Priority must be low, medium, high or critical");
        update.priority = value as (typeof PRIORITIES)[number];
        record("priority", before.priority, value);
        break;
      }
      case SYS.category: {
        const categoryId = toIdOrNull(value, "Category");
        if (categoryId) {
          if (!isUuid(categoryId) || !(await tx.category.findFirst({ where: { id: categoryId, projectId }, select: { id: true } }))) throw badRequest("Unknown category");
        }
        update.categoryId = categoryId;
        record("category", before.categoryId, categoryId);
        break;
      }
      case SYS.startDate: {
        const d = toDateOnly(value, "Start date");
        update.startDate = d;
        record("startDate", fromDateOnly(before.startDate), fromDateOnly(d));
        break;
      }
      case SYS.dueDate: {
        const d = toDateOnly(value, "Due date");
        update.dueDate = d;
        record("dueDate", fromDateOnly(before.dueDate), fromDateOnly(d));
        break;
      }
      case SYS.progress: {
        const n = toNumber(value, "Progress") ?? 0;
        if (n < 0 || n > 100) throw badRequest("Progress must be between 0 and 100");
        update.progress = Math.round(n);
        record("progress", before.progress, update.progress);
        break;
      }
      case SYS.estimate: {
        const hours = toNumber(value, "Estimate");
        if (hours !== null && hours < 0) throw badRequest("Estimate cannot be negative");
        update.estimateMinutes = hours === null ? null : Math.round(hours * 60);
        record("estimateMinutes", before.estimateMinutes, update.estimateMinutes);
        break;
      }
      case SYS.actual: {
        const hours = toNumber(value, "Actual time");
        if (hours !== null && hours < 0) throw badRequest("Actual time cannot be negative");
        update.actualMinutes = hours === null ? null : Math.round(hours * 60);
        record("actualMinutes", before.actualMinutes, update.actualMinutes);
        break;
      }
      case SYS.keyResult:
      case SYS.objective: {
        // sys_key_result takes a bare key-result id (legacy / imports);
        // sys_objective takes "kr:<id>" or "obj:<id>".
        const raw = toIdOrNull(value, "Objective");
        let objectiveId: string | null = null;
        let keyResultId: string | null = null;
        if (raw) {
          const [kind, id] = key === SYS.keyResult ? ["kr", raw] : raw.includes(":") ? raw.split(":", 2) : ["obj", raw];
          if (!isUuid(id) || (kind !== "kr" && kind !== "obj")) throw badRequest("Invalid objective");
          // The actor may only link objectives they can see (not those of projects hidden from them).
          const visibleObjective = await objectiveVisibility(tx, actorId);
          if (kind === "kr") {
            const kr = await tx.keyResult.findFirst({ where: { id, deletedAt: null, objective: { workspaceId, deletedAt: null, ...visibleObjective } }, select: { id: true, objectiveId: true } });
            if (!kr) throw badRequest("Unknown key result");
            keyResultId = kr.id;
            objectiveId = kr.objectiveId;
          } else {
            const o = await tx.objective.findFirst({ where: { id, workspaceId, deletedAt: null, ...visibleObjective }, select: { id: true } });
            if (!o) throw badRequest("Unknown objective");
            objectiveId = o.id;
          }
        }
        update.keyResultId = keyResultId;
        update.objectiveId = objectiveId;
        record("objective", okrTargetToken(before), okrTargetToken({ keyResultId, objectiveId }));
        break;
      }
      case SYS.importance: {
        if (value !== null && value !== "important" && value !== "not_important") throw badRequest("Invalid importance");
        update.importance = value as "important" | "not_important" | null;
        record("importance", before.importance, value);
        break;
      }
      case SYS.urgency: {
        if (value !== null && value !== "urgent" && value !== "not_urgent") throw badRequest("Invalid urgency");
        update.urgency = value as "urgent" | "not_urgent" | null;
        record("urgency", before.urgency, value);
        break;
      }
      case SYS.parent: {
        const ids = toIdArray(value, "Parent task");
        const parentId = ids.length ? ids[ids.length - 1] : null;
        if (parentId) {
          assertUuids([parentId], "Parent task");
          if (parentId === taskId) throw badRequest("A task cannot be its own parent");
          const parent = await tx.task.findFirst({ where: { id: parentId, projectId, deletedAt: null }, select: { id: true } });
          if (!parent) throw badRequest("Parent task must be in the same project");
          await assertNoParentCycle(tx, taskId, parentId);
        }
        update.parentTaskId = parentId;
        record("parentTask", before.parentTaskId, parentId);
        break;
      }
      case SYS.assignees: {
        const userIds = toIdArray(value, "Assignees");
        assertUuids(userIds, "Assignees");
        const members = await tx.workspaceMember.findMany({ where: { workspaceId, userId: { in: userIds }, user: { isActive: true, deletedAt: null } }, select: { userId: true } });
        if (members.length !== userIds.length) throw badRequest("Assignees must be active members of this workspace");
        const prev = before.assignees.map((a) => a.userId);
        const added = userIds.filter((u) => !prev.includes(u));
        const removed = prev.filter((u) => !userIds.includes(u));
        if (removed.length) await tx.taskAssignee.deleteMany({ where: { taskId, userId: { in: removed } } });
        if (added.length) await tx.taskAssignee.createMany({ data: added.map((userId) => ({ taskId, userId, assignedById: actorId })) });
        result.assigned = added;
        result.unassigned = removed;
        record("assignees", [...prev].sort(), [...userIds].sort());
        break;
      }
      case SYS.reportTo: {
        const userIds = toIdArray(value, "Report to");
        assertUuids(userIds, "Report to");
        const members = await tx.workspaceMember.findMany({ where: { workspaceId, userId: { in: userIds }, user: { isActive: true, deletedAt: null } }, select: { userId: true } });
        if (members.length !== userIds.length) throw badRequest("Report recipients must be active members of this workspace");
        const prev = before.reportTo.map((r) => r.userId);
        const added = userIds.filter((u) => !prev.includes(u));
        const removed = prev.filter((u) => !userIds.includes(u));
        if (removed.length) await tx.taskReportRecipient.deleteMany({ where: { taskId, userId: { in: removed } } });
        if (added.length) await tx.taskReportRecipient.createMany({ data: added.map((userId) => ({ taskId, userId, assignedById: actorId })) });
        result.reportAdded = added;
        record("reportTo", [...prev].sort(), [...userIds].sort());
        break;
      }
      case SYS.dependsOn: {
        const ids = toIdArray(value, "Depends on");
        assertUuids(ids, "Depends on");
        if (ids.includes(taskId)) throw badRequest("A task cannot depend on itself");
        const found = await tx.task.findMany({ where: { id: { in: ids }, workspaceId, deletedAt: null }, select: { id: true } });
        if (found.length !== ids.length) throw badRequest("Dependencies must be tasks in this workspace");
        const prev = before.dependencies.map((d) => d.dependsOnTaskId);
        const added = ids.filter((d) => !prev.includes(d));
        const removed = prev.filter((d) => !ids.includes(d));
        if (added.length) await assertNoDependencyCycle(tx, taskId, added);
        if (removed.length) await tx.taskDependency.deleteMany({ where: { taskId, dependsOnTaskId: { in: removed } } });
        if (added.length) await tx.taskDependency.createMany({ data: added.map((d) => ({ taskId, dependsOnTaskId: d, createdById: actorId })) });
        record("dependsOn", [...prev].sort(), [...ids].sort());
        break;
      }
      case SYS.recurrence: {
        const rule = parseRecurrence(value);
        update.recurrenceFreq = rule?.freq ?? null;
        update.recurrenceInterval = rule?.interval ?? null;
        record("recurrence", before.recurrenceFreq ? { freq: before.recurrenceFreq, interval: before.recurrenceInterval } : null, rule);
        break;
      }
      default: {
        const field = customById.get(key);
        if (!field) throw badRequest(`Unknown field: ${key}`);
        const prevRow = before.customValues.find((v) => v.customFieldId === key);
        const prevValue = prevRow ? customValueOut(field.type, prevRow) : null;
        const next = await writeCustomValue(tx, { taskId, field, value, actorId });
        record(`custom:${field.name}`, prevValue, next);
      }
    }
  }

  if (Object.keys(update).length || opts.isNew) {
    update.updatedById = actorId;
    await tx.task.update({ where: { id: taskId }, data: update });
    if (result.statusChanged && update.completedAt) await spawnNextOccurrence(tx, taskId, actorId);
  } else if (Object.keys(changes).length) {
    // Join-table-only change: still bump updated_at / updated_by on the task.
    await tx.task.update({ where: { id: taskId }, data: { updatedById: actorId } });
  }
  return result;
}

export type RecurrenceRule = { freq: "daily" | "weekly" | "monthly"; interval: number };

export function parseRecurrence(value: unknown): RecurrenceRule | null {
  if (value === null || value === undefined || value === "") return null;
  const v = value as { freq?: unknown; interval?: unknown };
  if (typeof v !== "object" || !["daily", "weekly", "monthly"].includes(v.freq as string)) throw badRequest("Recurrence must be daily, weekly or monthly");
  const interval = v.interval === undefined ? 1 : Number(v.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 365) throw badRequest("Recurrence interval must be 1-365");
  return { freq: v.freq as RecurrenceRule["freq"], interval };
}

/** Date `d` moved forward by one recurrence step (UTC date arithmetic, month ends clamp). */
export function addRecurrence(d: Date, rule: RecurrenceRule): Date {
  const out = new Date(d);
  if (rule.freq === "daily") out.setUTCDate(out.getUTCDate() + rule.interval);
  else if (rule.freq === "weekly") out.setUTCDate(out.getUTCDate() + 7 * rule.interval);
  else {
    const day = out.getUTCDate();
    out.setUTCDate(1);
    out.setUTCMonth(out.getUTCMonth() + rule.interval);
    const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
    out.setUTCDate(Math.min(day, last));
  }
  return out;
}

/**
 * Recurring tasks: completing one creates the next occurrence (same project,
 * details, people and OKR; dates moved by one step). Only once per task - a
 * reopened and re-completed occurrence doesn't create a second one.
 */
async function spawnNextOccurrence(tx: Tx, taskId: string, actorId: string | null) {
  const t = await tx.task.findUniqueOrThrow({ where: { id: taskId }, include: { assignees: true, reportTo: true, recurrenceNext: { select: { id: true } } } });
  if (!t.recurrenceFreq || t.recurrenceNext || t.deletedAt) return;
  const rule: RecurrenceRule = { freq: t.recurrenceFreq, interval: t.recurrenceInterval ?? 1 };
  const today = new Date(new Date().toISOString().slice(0, 10));
  // Next due date: one step after the old one, and never in the past.
  let due = t.dueDate ? addRecurrence(t.dueDate, rule) : addRecurrence(today, rule);
  while (due < today) due = addRecurrence(due, rule);
  const shift = t.dueDate ? due.getTime() - t.dueDate.getTime() : 0;
  const start = t.startDate ? new Date(t.startDate.getTime() + shift) : null;
  const defaultStatus =
    (await tx.status.findFirst({ where: { workspaceId: t.workspaceId, isDefault: true }, select: { id: true } })) ??
    (await tx.status.findFirst({ where: { workspaceId: t.workspaceId, category: "todo" }, orderBy: { sortOrder: "asc" }, select: { id: true } }));
  if (!defaultStatus) return;
  const next = await tx.task.create({
    data: {
      workspaceId: t.workspaceId,
      projectId: t.projectId,
      parentTaskId: t.parentTaskId,
      statusId: defaultStatus.id,
      categoryId: t.categoryId,
      keyResultId: t.keyResultId,
      objectiveId: t.objectiveId,
      title: t.title,
      description: t.description,
      content: t.content,
      priority: t.priority,
      importance: t.importance,
      urgency: t.urgency,
      estimateMinutes: t.estimateMinutes,
      okrWeight: t.okrWeight,
      startDate: start,
      dueDate: due,
      sortOrder: t.sortOrder + 0.5,
      recurrenceFreq: t.recurrenceFreq,
      recurrenceInterval: t.recurrenceInterval,
      recurrenceParentId: t.id,
      createdById: actorId,
      updatedById: actorId,
    },
    select: { id: true },
  });
  if (t.assignees.length) await tx.taskAssignee.createMany({ data: t.assignees.map((a) => ({ taskId: next.id, userId: a.userId, assignedById: actorId })) });
  if (t.reportTo.length) await tx.taskReportRecipient.createMany({ data: t.reportTo.map((r) => ({ taskId: next.id, userId: r.userId, assignedById: actorId })) });
}

async function writeCustomValue(
  tx: Tx,
  opts: { taskId: string; field: { id: string; name: string; type: CustomFieldType; options: { id: string }[] }; value: unknown; actorId: string | null }
): Promise<unknown> {
  const { taskId, field, value, actorId } = opts;
  const label = field.name;
  const empty: Prisma.TaskCustomFieldValueUncheckedCreateInput = {
    taskId,
    customFieldId: field.id,
    valueText: null,
    valueNumber: null,
    valueDate: null,
    valueBool: null,
    valueOptionId: null,
    valueUserId: null,
    valueOptionIds: [],
    updatedById: actorId,
  };
  let row: Prisma.TaskCustomFieldValueUncheckedCreateInput | null = null;
  let out: unknown = null;

  switch (field.type) {
    case "formula":
      throw badRequest(`${label} is computed and cannot be edited`);
    case "text":
    case "long_text":
    case "url":
    case "email":
    case "phone": {
      if (value !== null && value !== undefined && typeof value !== "string") throw badRequest(`${label} must be text`);
      const s = ((value as string | null) ?? "").trim();
      if (s && field.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw badRequest(`${label} must be an email address`);
      if (s && field.type === "url" && !/^https?:\/\//i.test(s)) throw badRequest(`${label} must start with http:// or https://`);
      if (s) row = { ...empty, valueText: s };
      out = s || null;
      break;
    }
    case "number":
    case "currency":
    case "percent":
    case "rating": {
      const n = toNumber(value, label);
      if (n !== null && field.type === "rating" && (n < 0 || n > 10)) throw badRequest(`${label} must be between 0 and 10`);
      if (n !== null) row = { ...empty, valueNumber: new Prisma.Decimal(n) };
      out = n;
      break;
    }
    case "checkbox": {
      const b = Boolean(value);
      if (b) row = { ...empty, valueBool: true };
      out = b;
      break;
    }
    case "date": {
      const d = toDateOnly(value, label);
      if (d) row = { ...empty, valueDate: d };
      out = d ? d.toISOString().slice(0, 10) : null;
      break;
    }
    case "datetime": {
      const d = toTimestamp(value, label);
      if (d) row = { ...empty, valueDate: d };
      out = d ? d.toISOString() : null;
      break;
    }
    case "single_select": {
      const id = toIdOrNull(value, label);
      if (id && !field.options.some((o) => o.id === id)) throw badRequest(`${label}: unknown option`);
      if (id) row = { ...empty, valueOptionId: id };
      out = id;
      break;
    }
    case "multi_select": {
      const ids = toIdArray(value, label);
      if (ids.some((id) => !field.options.some((o) => o.id === id))) throw badRequest(`${label}: unknown option`);
      if (ids.length) row = { ...empty, valueOptionIds: ids };
      out = ids;
      break;
    }
    case "person": {
      const id = toIdOrNull(value, label);
      if (id) {
        const task = await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: { workspaceId: true } });
        const member = isUuid(id) && (await tx.workspaceMember.findFirst({ where: { workspaceId: task.workspaceId, userId: id }, select: { id: true } }));
        if (!member) throw badRequest(`${label} must be a workspace member`);
        row = { ...empty, valueUserId: id };
      }
      out = id;
      break;
    }
  }

  if (row) {
    await tx.taskCustomFieldValue.upsert({
      where: { taskId_customFieldId: { taskId, customFieldId: field.id } },
      create: row,
      update: { ...row, taskId: undefined, customFieldId: undefined },
    });
  } else {
    await tx.taskCustomFieldValue.deleteMany({ where: { taskId, customFieldId: field.id } });
  }
  return out;
}

/** Creates a task with sensible defaults, then applies the initial patch in the same transaction. */
export async function createTask(
  tx: Tx,
  opts: { projectId: string; workspaceId: string; actorId: string | null; data: Record<string, unknown> }
): Promise<string> {
  const { projectId, workspaceId, actorId } = opts;
  const data = { ...opts.data };
  const defaultStatus =
    (await tx.status.findFirst({ where: { workspaceId, isDefault: true }, select: { id: true } })) ??
    (await tx.status.findFirst({ where: { workspaceId }, orderBy: { sortOrder: "asc" }, select: { id: true } }));
  if (!defaultStatus) throw badRequest("This workspace has no statuses yet - add one in Settings first");
  const last = await tx.task.aggregate({ where: { projectId, deletedAt: null }, _max: { sortOrder: true } });
  const rawTitle = typeof data[SYS.title] === "string" ? (data[SYS.title] as string).trim() : "";
  const title = rawTitle || "Untitled task";
  delete data[SYS.title];

  const task = await tx.task.create({
    data: {
      workspaceId,
      projectId,
      statusId: defaultStatus.id,
      title,
      sortOrder: (last._max.sortOrder ?? 0) + 1,
      createdById: actorId,
      updatedById: actorId,
    },
    select: { id: true },
  });
  if (Object.keys(data).length) {
    await applyTaskPatch(tx, { taskId: task.id, projectId, workspaceId, actorId, data, isNew: true });
  }
  return task.id;
}
