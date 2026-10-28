// Adapter between the normalized task schema and the generic field/record
// shape the view components (grid, kanban, calendar, gantt, gallery, form,
// eisenhower, dashboards, export) consume. The code lives in src/server/tasks/
// (values, read, write, recurrence); this file keeps the existing imports working.
//
// System field ids are stable strings (`sys_*`); custom field ids are uuids.

export { SYS, PRIORITIES, okrTargetToken, toDateOnly, fromDateOnly, isUuid } from "@/server/tasks/values";
export { TASK_INCLUDE, type TaskWithRelations, loadProjectMeta, buildFields, toRecord, resolveComputedFields, loadProjectGrid, loadProjectGridPage, loadTaskRecord } from "@/server/tasks/read";
export { type PatchResult, applyTaskPatch, createTask } from "@/server/tasks/write";
export { type RecurrenceRule, parseRecurrence, addRecurrence } from "@/server/tasks/recurrence";
