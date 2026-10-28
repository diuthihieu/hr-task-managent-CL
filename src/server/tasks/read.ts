// Read side: tasks + statuses + categories + custom fields -> FieldRow[] / RecordRow[] for the views.
import { Prisma, type CustomFieldType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest } from "@/lib/http-errors";
import { IMPORTANCE_OPTIONS, URGENCY_OPTIONS, PRIORITY_OPTIONS_DEFAULT, parseFieldConfig } from "@/lib/field-types";
import type { FieldRow, RecordRow } from "@/types";
import { makeT, type MessageKey, type TFunction } from "@/lib/i18n/core";
import { getCellValue } from "@/lib/query-engine";
import { SYS, fromDateOnly, isUuid, okrTargetToken } from "./values";

type Tx = Prisma.TransactionClient;

export const TASK_INCLUDE = {
  assignees: { select: { userId: true } },
  reportTo: { select: { userId: true } },
  dependencies: { select: { dependsOnTaskId: true } },
  customValues: true,
  attachments: { where: { deletedAt: null }, select: { id: true, fileName: true, contentType: true }, orderBy: { createdAt: "asc" } },
} satisfies Prisma.TaskInclude;

export type TaskWithRelations = Prisma.TaskGetPayload<{ include: typeof TASK_INCLUDE }>;

export interface ProjectMeta {
  project: { id: string; workspaceId: string; name: string };
  statuses: { id: string; name: string; color: string; category: string; isDefault: boolean }[];
  categories: { id: string; name: string; color: string }[];
  customFields: Prisma.CustomFieldGetPayload<{ include: { options: true } }>[];
  /** Objectives set up in this project; the "Objective" field only appears when there is at least one. */
  objectives: { id: string; title: string; keyResults: { id: string; title: string }[] }[];
  teams: { id: string; name: string; color: string }[];
}

export async function loadProjectMeta(projectId: string, db: Tx | typeof prisma = prisma): Promise<ProjectMeta | null> {
  const project = await db.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, workspaceId: true, name: true } });
  if (!project) return null;
  const [statuses, categories, customFields, objectives, teams] = await Promise.all([
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
    db.team.findMany({ where: { workspaceId: project.workspaceId }, orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
  ]);
  return { project, statuses, categories, customFields, objectives, teams };
}

export function sysField(projectId: string, id: string, name: string, type: string, order: number, extra: Partial<FieldRow> = {}): FieldRow {
  return { id, projectId, name, type, config: null, order, isPrimary: false, visible: true, description: null, defaultValue: null, system: true, ...extra };
}

export function buildFields(meta: ProjectMeta, t: TFunction = makeT("en")): FieldRow[] {
  const pid = meta.project.id;
  const n = (id: string) => t(`field.${id}` as MessageKey);
  const opts = (o: object) => JSON.stringify(o);
  const sys: FieldRow[] = [
    sysField(pid, SYS.title, n(SYS.title), "text", 0, { isPrimary: true }),
    sysField(pid, SYS.description, n(SYS.description), "long_text", 0.5),
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
    sysField(pid, SYS.completedAt, n(SYS.completedAt), "datetime", 7.5, { description: t("fieldHint.sys_completed_at") }),
    sysField(pid, SYS.estimate, n(SYS.estimate), "number", 8, { config: opts({ precision: 2 }) }),
    sysField(pid, SYS.actual, n(SYS.actual), "number", 8.5, { config: opts({ precision: 2 }), description: t("fieldHint.sys_actual") }),
    ...(meta.objectives.length
      ? [sysField(pid, SYS.objective, n(SYS.objective), "okr_target", 9, { config: opts({ objectives: meta.objectives }) })]
      : []),
    sysField(pid, SYS.importance, n(SYS.importance), "importance", 10, { config: opts({ options: IMPORTANCE_OPTIONS }) }),
    sysField(pid, SYS.urgency, n(SYS.urgency), "urgency", 11, { config: opts({ options: URGENCY_OPTIONS }) }),
    sysField(pid, SYS.dependsOn, n(SYS.dependsOn), "link", 12, { config: opts({ linkProjectId: pid }), description: t("fieldHint.sys_depends_on") }),
    sysField(pid, SYS.parent, n(SYS.parent), "link", 13, { config: opts({ linkProjectId: pid, maxLinks: 1 }), description: t("fieldHint.sys_parent") }),
    sysField(pid, SYS.attachments, n(SYS.attachments), "task_attachments", 15, { readOnly: true }),
  ];
  const custom: FieldRow[] = meta.customFields.map((f, i) => {
    const settings = (f.settings ?? {}) as Record<string, unknown>;
    const config: Record<string, unknown> = { ...settings };
    if (f.type === "single_select" || f.type === "multi_select") {
      config.options = f.options.map((o) => ({ id: o.id, label: o.label, color: o.color }));
    }
    if (f.type === "team") config.teams = meta.teams;
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
    sysField(pid, SYS.updatedBy, n(SYS.updatedBy), "modified_by", 1003, { readOnly: true }),
  ];
  return [...sys, ...custom, ...tail];
}

export function customValueOut(type: CustomFieldType, v: TaskWithRelations["customValues"][number]): unknown {
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
    case "team":
      return v.valueTeamId;
    case "link":
      return v.valueTaskIds;
    case "location":
    case "json":
    case "api_result":
      return v.valueJson;
    case "formula":
    case "lookup":
    case "rollup":
    case "button":
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
    [SYS.completedAt]: task.completedAt ? task.completedAt.toISOString() : null,
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
    [SYS.updatedBy]: task.updatedById,
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

/** Resolve lookup/rollup values from already-authorized records in one project. */
export function resolveComputedFields(records: RecordRow[], fields: FieldRow[]): RecordRow[] {
  const computed = fields.filter((f) => f.type === "lookup" || f.type === "rollup");
  if (!computed.length) return records;
  const byRecord = new Map(records.map((r) => [r.id, r]));
  const byField = new Map(fields.map((f) => [f.id, f]));

  // Two passes allow a rollup to consume a lookup declared earlier without
  // permitting unbounded recursive formulas.
  for (let pass = 0; pass < 2; pass++) {
    for (const record of records) {
      for (const field of computed) {
        const cfg = parseFieldConfig(field.config);
        if (!cfg.lookupLinkFieldId) {
          record.data[field.id] = field.type === "rollup" ? 0 : [];
          continue;
        }
        const rawLinks = record.data[cfg.lookupLinkFieldId];
        const linkedIds = Array.isArray(rawLinks) ? rawLinks.map(String) : rawLinks ? [String(rawLinks)] : [];
        const linked = linkedIds.map((id) => byRecord.get(id)).filter((r): r is RecordRow => !!r);
        if (field.type === "lookup") {
          const target = cfg.lookupFieldId ? byField.get(cfg.lookupFieldId) : undefined;
          const values = target
            ? linked.flatMap((r) => {
                const v = getCellValue(r, target, fields);
                return Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v];
              })
            : linked.map((r) => r.data[SYS.title]);
          record.data[field.id] = [...new Map(values.map((v) => [JSON.stringify(v), v])).values()];
          continue;
        }
        const target = cfg.lookupFieldId ? byField.get(cfg.lookupFieldId) : undefined;
        const values = target
          ? linked.flatMap((r) => {
              const v = getCellValue(r, target, fields);
              return Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v];
            })
          : linked.map(() => 1);
        const nums = values.map(Number).filter(Number.isFinite);
        const fn = cfg.rollupFn ?? "count";
        record.data[field.id] =
          fn === "count" ? values.length : !nums.length ? 0 : fn === "sum" ? nums.reduce((a, b) => a + b, 0) : fn === "avg" ? nums.reduce((a, b) => a + b, 0) / nums.length : fn === "min" ? Math.min(...nums) : Math.max(...nums);
      }
    }
  }
  return records;
}

export async function loadProjectGrid(projectId: string) {
  const meta = await loadProjectMeta(projectId);
  if (!meta) return null;
  const tasks = await prisma.task.findMany({
    where: { projectId, deletedAt: null },
    include: TASK_INCLUDE,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  const types = new Map(meta.customFields.map((f) => [f.id, f.type]));
  const fields = buildFields(meta);
  return { meta, fields, records: resolveComputedFields(tasks.map((t) => toRecord(t, types)), fields) };
}

export interface TaskCursor {
  order: number;
  createdAt: string;
  id: string;
}

export function decodeTaskCursor(raw: string | undefined): TaskCursor | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<TaskCursor>;
    return typeof value.order === "number" && typeof value.createdAt === "string" && isUuid(value.id) ? value as TaskCursor : null;
  } catch {
    return null;
  }
}

export function encodeTaskCursor(task: { sortOrder: number; createdAt: Date; id: string }) {
  return Buffer.from(JSON.stringify({ order: task.sortOrder, createdAt: task.createdAt.toISOString(), id: task.id }), "utf8").toString("base64url");
}

/** Stable keyset pagination for large grid/search requests; never uses OFFSET. */
export async function loadProjectGridPage(projectId: string, input: { limit?: number; cursor?: string; search?: string }) {
  const meta = await loadProjectMeta(projectId);
  if (!meta) return null;
  const limit = Math.max(1, Math.min(200, Math.round(input.limit ?? 100)));
  const cursor = decodeTaskCursor(input.cursor);
  if (input.cursor && !cursor) throw badRequest("Invalid task cursor");
  const search = input.search?.trim().slice(0, 200);
  const after: Prisma.TaskWhereInput | undefined = cursor ? {
    OR: [
      { sortOrder: { gt: cursor.order } },
      { sortOrder: cursor.order, createdAt: { gt: new Date(cursor.createdAt) } },
      { sortOrder: cursor.order, createdAt: new Date(cursor.createdAt), id: { gt: cursor.id } },
    ],
  } : undefined;
  const where: Prisma.TaskWhereInput = {
    projectId,
    deletedAt: null,
    ...(search ? { title: { contains: search, mode: "insensitive" } } : {}),
    ...(after ?? {}),
  };
  const [rows, total] = await Promise.all([
    prisma.task.findMany({ where, include: TASK_INCLUDE, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: limit + 1 }),
    prisma.task.count({ where: { projectId, deletedAt: null, ...(search ? { title: { contains: search, mode: "insensitive" } } : {}) } }),
  ]);
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const types = new Map(meta.customFields.map((field) => [field.id, field.type]));
  const fields = buildFields(meta);
  let records = pageRows.map((task) => toRecord(task, types));
  if (meta.customFields.some((field) => field.type === "lookup" || field.type === "rollup")) {
    const linkedIds = [...new Set(records.flatMap((record) => fields.filter((field) => field.type === "link").flatMap((field) => Array.isArray(record.data[field.id]) ? record.data[field.id] as string[] : [])))];
    const linked = linkedIds.length ? await prisma.task.findMany({ where: { id: { in: linkedIds }, projectId, deletedAt: null }, include: TASK_INCLUDE }) : [];
    const pageIds = new Set(records.map((record) => record.id));
    records = resolveComputedFields([...records, ...linked.map((task) => toRecord(task, types))], fields).filter((record) => pageIds.has(record.id));
  }
  const last = pageRows.at(-1);
  return { items: records, total, nextCursor: hasMore && last ? encodeTaskCursor(last) : null };
}

export async function loadTaskRecord(taskId: string, db: Tx | typeof prisma = prisma): Promise<RecordRow | null> {
  const task = await db.task.findFirst({ where: { id: taskId, deletedAt: null }, include: TASK_INCLUDE });
  if (!task) return null;
  const meta = await loadProjectMeta(task.projectId, db);
  if (!meta) return null;
  const types = new Map(meta.customFields.map((f) => [f.id, f.type]));
  const fields = buildFields(meta);
  if (!meta.customFields.some((f) => f.type === "lookup" || f.type === "rollup")) return toRecord(task, types);
  const tasks = await db.task.findMany({ where: { projectId: task.projectId, deletedAt: null }, include: TASK_INCLUDE, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }] });
  return resolveComputedFields(tasks.map((t) => toRecord(t, types)), fields).find((r) => r.id === taskId) ?? null;
}
