// "Export my data": task rows from every workspace the user belongs to, merged into one file.
// This module only shapes rows (columns, hours, summary, CSV); reading the tasks with the user's
// permissions lives in my-export.ts.

export const EXPORT_COLUMNS = [
  "workspace",
  "project",
  "title",
  "parent",
  "status",
  "category",
  "priority",
  "assignees",
  "reportTo",
  "startDate",
  "dueDate",
  "completedAt",
  "estimateH",
  "actualH",
  "ownActualH",
  "progress",
  "createdAt",
  "createdBy",
  "link",
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];

export const DEFAULT_EXPORT_COLUMNS: ExportColumn[] = ["workspace", "project", "title", "status", "assignees", "reportTo", "startDate", "dueDate", "completedAt", "actualH", "ownActualH"];

export interface ExportTask {
  id: string;
  workspace: string;
  workspaceSlug: string;
  projectId: string;
  project: string;
  title: string;
  parent: string | null;
  status: string;
  category: string | null;
  priority: string;
  assignees: { id: string; name: string }[];
  reportTo: { id: string; name: string }[];
  startDate: Date | null;
  dueDate: Date | null;
  completedAt: Date | null;
  estimateMinutes: number | null;
  actualMinutes: number | null;
  /** Actual minutes of the task itself: a parent's total minus its sub-tasks'. */
  ownActualMinutes: number;
  ownEstimateMinutes: number;
  progress: number;
  createdAt: Date;
  createdBy: string | null;
}

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const hours = (min: number | null) => (min == null ? "" : Math.round((min / 60) * 100) / 100);

/** One cell value per chosen column (numbers stay numbers for Excel). */
export function exportCell(t: ExportTask, col: ExportColumn, origin: string): string | number {
  switch (col) {
    case "workspace":
      return t.workspace;
    case "project":
      return t.project;
    case "title":
      return t.title;
    case "parent":
      return t.parent ?? "";
    case "status":
      return t.status;
    case "category":
      return t.category ?? "";
    case "priority":
      return t.priority;
    case "assignees":
      return t.assignees.map((a) => a.name).join(", ");
    case "reportTo":
      return t.reportTo.map((a) => a.name).join(", ");
    case "startDate":
      return day(t.startDate);
    case "dueDate":
      return day(t.dueDate);
    case "completedAt":
      return day(t.completedAt);
    case "estimateH":
      return hours(t.estimateMinutes);
    case "actualH":
      return hours(t.actualMinutes);
    case "ownActualH":
      return hours(t.ownActualMinutes);
    case "progress":
      return t.progress;
    case "createdAt":
      return day(t.createdAt);
    case "createdBy":
      return t.createdBy ?? "";
    case "link":
      return `${origin}/w/${t.workspaceSlug}/p/${t.projectId}/t/${t.id}`;
  }
}

export function exportRows(tasks: ExportTask[], columns: ExportColumn[], origin: string): (string | number)[][] {
  return tasks.map((t) => columns.map((c) => exportCell(t, c, origin)));
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel shows Vietnamese correctly. */
export function toCsv(header: string[], rows: (string | number)[][]): string {
  const cell = (v: string | number) => {
    // Text starting with = + - @ is prefixed so a spreadsheet shows it instead of running it as a formula.
    const s = typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export interface ProjectTotal {
  workspace: string;
  project: string;
  tasks: number;
  estimateH: number;
  actualH: number;
}
export interface PersonTotal {
  person: string;
  workspace: string;
  tasks: number;
  actualH: number;
}

const round = (min: number) => Math.round((min / 60) * 100) / 100;

/**
 * Totals for the summary sheet. Per project each task counts once with its OWN hours (a parent's
 * hours already include its sub-tasks', so they are never added twice). Per person a task shared
 * by several assignees counts in full for each of them (person-hours).
 */
export function exportSummary(tasks: ExportTask[]): { projects: ProjectTotal[]; people: PersonTotal[]; totalActualH: number; totalTasks: number } {
  const projects = new Map<string, { workspace: string; project: string; tasks: number; est: number; act: number }>();
  const people = new Map<string, { person: string; workspace: string; tasks: number; act: number }>();
  let total = 0;
  for (const t of tasks) {
    const pk = t.projectId;
    const p = projects.get(pk) ?? { workspace: t.workspace, project: t.project, tasks: 0, est: 0, act: 0 };
    p.tasks++;
    p.est += t.ownEstimateMinutes;
    p.act += t.ownActualMinutes;
    projects.set(pk, p);
    total += t.ownActualMinutes;
    const who = t.assignees.length ? t.assignees : [{ id: "", name: "(unassigned)" }];
    for (const a of who) {
      const key = `${a.id}\u0000${a.name}\u0000${t.workspaceSlug}`;
      const r = people.get(key) ?? { person: a.name, workspace: t.workspace, tasks: 0, act: 0 };
      r.tasks++;
      r.act += t.ownActualMinutes;
      people.set(key, r);
    }
  }
  return {
    projects: [...projects.values()].sort((a, b) => a.workspace.localeCompare(b.workspace) || a.project.localeCompare(b.project)).map((p) => ({ workspace: p.workspace, project: p.project, tasks: p.tasks, estimateH: round(p.est), actualH: round(p.act) })),
    people: [...people.values()].sort((a, b) => a.person.localeCompare(b.person) || a.workspace.localeCompare(b.workspace)).map((p) => ({ person: p.person, workspace: p.workspace, tasks: p.tasks, actualH: round(p.act) })),
    totalActualH: round(total),
    totalTasks: tasks.length,
  };
}
