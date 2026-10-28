// Write side: a RecordRow-style `{ [fieldId]: value }` patch -> typed column updates, assignee /
// dependency join rows and custom-field value rows, validated and written in the caller's transaction.
import { Prisma, type CustomFieldType } from "@prisma/client";
import { badRequest } from "@/lib/http-errors";
import { objectiveVisibility } from "@/lib/okr-write";
import { PRIORITIES, READ_ONLY_SYS, SYS, assertUuids, fromDateOnly, isUuid, okrTargetToken, toDateOnly, toIdArray, toIdOrNull, toNumber, toTimestamp } from "./values";
import { TASK_INCLUDE, customValueOut } from "./read";
import { parseRecurrence, spawnNextOccurrence } from "./recurrence";

type Tx = Prisma.TransactionClient;

export interface PatchResult {
  changes: Record<string, { from: unknown; to: unknown }>;
  statusChanged: boolean;
  /** The status changed to one in the "done" category. */
  becameDone: boolean;
  /** Name of the new status when it changed (for notifications). */
  newStatusName?: string;
  assigned: string[];
  unassigned: string[];
  /** Users newly added to "Report to". */
  reportAdded: string[];
}

/** Walks the dependency graph from each prerequisite; rejects if it reaches `taskId`. */
export async function assertNoDependencyCycle(tx: Tx, taskId: string, dependsOn: string[]) {
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

export async function assertNoParentCycle(tx: Tx, taskId: string, parentId: string) {
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
  const result: PatchResult = { changes, statusChanged: false, becameDone: false, assigned: [], unassigned: [], reportAdded: [] };
  const record = (key: string, from: unknown, to: unknown) => {
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
  };
  let becameDone = false;

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
          becameDone = result.becameDone = status.category === "done";
          // An explicit completed time in the same patch wins over "now".
          if (!(SYS.completedAt in data)) update.completedAt = becameDone ? new Date() : null;
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
      case SYS.completedAt: {
        const d = toTimestamp(value, "Completed time");
        if (d && d.getTime() > Date.now() + 24 * 3600_000) throw badRequest("Completed time cannot be in the future");
        update.completedAt = d;
        record("completedAt", before.completedAt?.toISOString() ?? null, d?.toISOString() ?? null);
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

  if ("startDate" in update || "dueDate" in update || "parentTaskId" in update) {
    await assertDatesWithinParent(tx, {
      taskId,
      start: "startDate" in update ? (update.startDate as Date | null) : before.startDate,
      due: "dueDate" in update ? (update.dueDate as Date | null) : before.dueDate,
      parentId: "parentTaskId" in update ? (update.parentTaskId as string | null) : before.parentTaskId,
      checkChildren: "startDate" in update || "dueDate" in update,
    });
  }

  if (Object.keys(update).length || opts.isNew) {
    update.updatedById = actorId;
    await tx.task.update({ where: { id: taskId }, data: update });
    if (result.statusChanged && becameDone) await spawnNextOccurrence(tx, taskId, actorId);
  } else if (Object.keys(changes).length) {
    // Join-table-only change: still bump updated_at / updated_by on the task.
    await tx.task.update({ where: { id: taskId }, data: { updatedById: actorId } });
  }
  return result;
}

export const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
export const rangeText = (start: Date | null, due: Date | null) => `${start ? dmy(start) : "…"} - ${due ? dmy(due) : "…"}`;
/** Is [start, due] (open ends allowed) inside [outerStart, outerDue]? */
export function insideRange(start: Date | null, due: Date | null, outerStart: Date | null, outerDue: Date | null) {
  for (const d of [start, due]) {
    if (!d) continue;
    if (outerStart && d < outerStart) return false;
    if (outerDue && d > outerDue) return false;
  }
  return true;
}

/**
 * A sub-task's start / due dates must stay inside its parent task's dates; a parent task's dates
 * cannot shrink so that a sub-task falls outside them.
 */
export async function assertDatesWithinParent(tx: Tx, o: { taskId: string; start: Date | null; due: Date | null; parentId: string | null; checkChildren: boolean }) {
  if (o.parentId) {
    const parent = await tx.task.findFirst({ where: { id: o.parentId, deletedAt: null }, select: { title: true, startDate: true, dueDate: true } });
    if (parent && !insideRange(o.start, o.due, parent.startDate, parent.dueDate)) {
      const range = rangeText(parent.startDate, parent.dueDate);
      throw badRequest(`Ngày của task con phải nằm trong khoảng ngày của task mẹ "${parent.title}" (${range}) · Sub-task dates must stay within the parent task's dates (${range})`);
    }
  }
  if (o.checkChildren && (o.start || o.due)) {
    const children = await tx.task.findMany({ where: { parentTaskId: o.taskId, deletedAt: null }, select: { title: true, startDate: true, dueDate: true } });
    const outside = children.filter((c) => !insideRange(c.startDate, c.dueDate, o.start, o.due));
    if (outside.length) {
      const first = `"${outside[0].title}" (${rangeText(outside[0].startDate, outside[0].dueDate)})`;
      throw badRequest(`Ngày mới làm ${outside.length} task con nằm ngoài khoảng ngày của task mẹ, ví dụ ${first} - hãy sửa ngày task con trước · These dates would leave ${outside.length} sub-task(s) outside the parent's dates, e.g. ${first}`);
    }
  }
}

export async function writeCustomValue(
  tx: Tx,
  opts: { taskId: string; field: { id: string; name: string; type: CustomFieldType; settings: Prisma.JsonValue; options: { id: string }[] }; value: unknown; actorId: string | null }
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
    valueTeamId: null,
    valueTaskIds: [],
    valueJson: Prisma.DbNull,
    valueOptionIds: [],
    updatedById: actorId,
  };
  let row: Prisma.TaskCustomFieldValueUncheckedCreateInput | null = null;
  let out: unknown = null;

  switch (field.type) {
    case "formula":
    case "lookup":
    case "rollup":
    case "button":
    case "ai_field":
    case "api_result":
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
    case "team": {
      const id = toIdOrNull(value, label);
      if (id) {
        const task = await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: { workspaceId: true } });
        const team = isUuid(id) && (await tx.team.findFirst({ where: { id, workspaceId: task.workspaceId }, select: { id: true } }));
        if (!team) throw badRequest(`${label} must be a team in this workspace`);
        row = { ...empty, valueTeamId: id };
      }
      out = id;
      break;
    }
    case "link": {
      const ids = toIdArray(value, label);
      assertUuids(ids, label);
      const cfg = (field.settings ?? {}) as Record<string, unknown>;
      const max = typeof cfg.maxLinks === "number" ? Math.max(1, Math.min(100, Math.round(cfg.maxLinks))) : 20;
      if (ids.length > max) throw badRequest(`${label} accepts at most ${max} linked tasks`);
      if (ids.includes(taskId)) throw badRequest(`${label} cannot link a task to itself`);
      if (ids.length) {
        const task = await tx.task.findUniqueOrThrow({ where: { id: taskId }, select: { workspaceId: true, projectId: true } });
        const found = await tx.task.findMany({ where: { id: { in: ids }, workspaceId: task.workspaceId, projectId: task.projectId, deletedAt: null }, select: { id: true } });
        if (found.length !== ids.length) throw badRequest(`${label} can only link active tasks in this project`);
        row = { ...empty, valueTaskIds: ids };
      }
      out = ids;
      break;
    }
    case "location": {
      if (value === null || value === undefined || value === "") {
        out = null;
        break;
      }
      const raw = typeof value === "string" ? { address: value } : value;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw badRequest(`${label} must be a location object`);
      const input = raw as { address?: unknown; lat?: unknown; lng?: unknown };
      const address = typeof input.address === "string" ? input.address.trim().slice(0, 500) : "";
      const lat = input.lat === undefined || input.lat === null || input.lat === "" ? undefined : Number(input.lat);
      const lng = input.lng === undefined || input.lng === null || input.lng === "" ? undefined : Number(input.lng);
      if (lat !== undefined && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw badRequest(`${label}: latitude must be between -90 and 90`);
      if (lng !== undefined && (!Number.isFinite(lng) || lng < -180 || lng > 180)) throw badRequest(`${label}: longitude must be between -180 and 180`);
      if (!address && lat === undefined && lng === undefined) {
        out = null;
        break;
      }
      const normalized = { ...(address ? { address } : {}), ...(lat !== undefined ? { lat } : {}), ...(lng !== undefined ? { lng } : {}) };
      row = { ...empty, valueJson: normalized };
      out = normalized;
      break;
    }
    case "signature": {
      if (value === null || value === undefined || value === "") {
        out = null;
        break;
      }
      if (typeof value !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value) || value.length > 150_000) {
        throw badRequest(`${label} must be a PNG signature smaller than 110 KB`);
      }
      row = { ...empty, valueText: value };
      out = value;
      break;
    }
    case "barcode": {
      if (value !== null && value !== undefined && typeof value !== "string") throw badRequest(`${label} must be text`);
      const s = ((value as string | null) ?? "").trim();
      if (s.length > 200) throw badRequest(`${label} is too long (max 200 characters)`);
      if (s) row = { ...empty, valueText: s };
      out = s || null;
      break;
    }
    case "json": {
      if (value === null || value === undefined || value === "") {
        out = null;
        break;
      }
      let normalized: unknown = value;
      if (typeof value === "string") {
        try {
          normalized = JSON.parse(value);
        } catch {
          throw badRequest(`${label} must contain valid JSON`);
        }
      }
      const encoded = JSON.stringify(normalized);
      if (!encoded || encoded.length > 64 * 1024) throw badRequest(`${label} JSON must be smaller than 64 KB`);
      row = { ...empty, valueJson: normalized as Prisma.InputJsonValue };
      out = normalized;
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
