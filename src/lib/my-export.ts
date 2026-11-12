import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/authz";
import type { ExportTask } from "@/lib/my-export-format";

/** At most this many tasks per export; the preview tells the user to narrow the filters. */
export const MY_EXPORT_MAX_ROWS = 20_000;

export interface DateRange {
  from?: string | null;
  to?: string | null;
}
export interface MyExportFilters {
  workspaceIds?: string[];
  projectIds?: string[];
  assigneeIds?: string[];
  reporterIds?: string[];
  statuses?: string[];
  startDate?: DateRange;
  dueDate?: DateRange;
  completedAt?: DateRange;
}

/**
 * Workspaces the user is a MEMBER of (support access of a system admin is not used here: the
 * export is "my data", not every workspace of the server).
 */
async function myWorkspaces(user: SessionUser) {
  const rows = await prisma.workspaceMember.findMany({
    where: { userId: user.id, workspace: { deletedAt: null } },
    select: { workspace: { select: { id: true, name: true, slug: true } } },
    orderBy: { workspace: { name: "asc" } },
  });
  return rows.map((r) => r.workspace);
}

/** Every task the user may see: workspaces they belong to, live projects not hidden from them. */
function visibleTaskWhere(user: SessionUser, workspaceIds: string[]): Prisma.TaskWhereInput {
  // Hidden projects are always left out (also for a system admin: this is a member export).
  return { workspaceId: { in: workspaceIds }, deletedAt: null, project: { deletedAt: null, hiddenMembers: { none: { userId: user.id } } } };
}

export async function myExportOptions(user: SessionUser) {
  const workspaces = await myWorkspaces(user);
  const ids = workspaces.map((w) => w.id);
  const [projects, members, statuses] = await Promise.all([
    prisma.project.findMany({ where: { workspaceId: { in: ids }, deletedAt: null, hiddenMembers: { none: { userId: user.id } } }, select: { id: true, name: true, workspaceId: true }, orderBy: { name: "asc" } }),
    prisma.workspaceMember.findMany({ where: { workspaceId: { in: ids } }, select: { workspaceId: true, user: { select: { id: true, name: true, email: true } } } }),
    prisma.status.findMany({ where: { workspaceId: { in: ids } }, select: { name: true }, distinct: ["name"], orderBy: { name: "asc" } }),
  ]);
  const people = new Map<string, { id: string; name: string; email: string; workspaceIds: string[] }>();
  for (const m of members) {
    const p = people.get(m.user.id) ?? { ...m.user, workspaceIds: [] };
    p.workspaceIds.push(m.workspaceId);
    people.set(m.user.id, p);
  }
  return {
    me: user.id,
    workspaces: workspaces.map((w) => ({ id: w.id, name: w.name })),
    projects,
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
    statuses: statuses.map((s) => s.name),
  };
}

const startOf = (d: string) => new Date(`${d}T00:00:00.000Z`);
const afterEnd = (d: string) => new Date(new Date(`${d}T00:00:00.000Z`).getTime() + 86_400_000);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function range(r: DateRange | undefined): Prisma.DateTimeNullableFilter | undefined {
  const from = r?.from && DATE.test(r.from) ? r.from : null;
  const to = r?.to && DATE.test(r.to) ? r.to : null;
  if (!from && !to) return undefined;
  return { ...(from ? { gte: startOf(from) } : {}), ...(to ? { lt: afterEnd(to) } : {}) };
}

export function myExportWhere(user: SessionUser, allowedWorkspaceIds: string[], f: MyExportFilters): Prisma.TaskWhereInput {
  const ws = f.workspaceIds?.length ? allowedWorkspaceIds.filter((id) => f.workspaceIds!.includes(id)) : allowedWorkspaceIds;
  const and: Prisma.TaskWhereInput[] = [visibleTaskWhere(user, ws)];
  if (f.projectIds?.length) and.push({ projectId: { in: f.projectIds } });
  if (f.assigneeIds?.length) and.push({ assignees: { some: { userId: { in: f.assigneeIds } } } });
  if (f.reporterIds?.length) and.push({ reportTo: { some: { userId: { in: f.reporterIds } } } });
  if (f.statuses?.length) and.push({ status: { name: { in: f.statuses } } });
  const start = range(f.startDate);
  const due = range(f.dueDate);
  const done = range(f.completedAt);
  if (start) and.push({ startDate: start });
  if (due) and.push({ dueDate: due });
  if (done) and.push({ completedAt: done });
  return { AND: and };
}

/** The tasks of an export (permission-filtered), with own hours computed against all visible sub-tasks. */
export async function loadMyExport(user: SessionUser, filters: MyExportFilters): Promise<{ tasks: ExportTask[]; tooMany: boolean; count: number; workspaceIds: string[] }> {
  const workspaces = await myWorkspaces(user);
  const allowed = workspaces.map((w) => w.id);
  if (!allowed.length) return { tasks: [], tooMany: false, count: 0, workspaceIds: [] };
  const where = myExportWhere(user, allowed, filters);
  const count = await prisma.task.count({ where });
  if (count > MY_EXPORT_MAX_ROWS) return { tasks: [], tooMany: true, count, workspaceIds: [] };
  const rows = await prisma.task.findMany({
    where,
    orderBy: [{ workspaceId: "asc" }, { projectId: "asc" }, { sortOrder: "asc" }],
    select: {
      id: true,
      title: true,
      projectId: true,
      priority: true,
      progress: true,
      startDate: true,
      dueDate: true,
      completedAt: true,
      createdAt: true,
      estimateMinutes: true,
      actualMinutes: true,
      workspace: { select: { id: true, name: true, slug: true } },
      project: { select: { name: true } },
      parentTask: { select: { title: true, deletedAt: true } },
      status: { select: { name: true } },
      category: { select: { name: true } },
      createdBy: { select: { name: true } },
      assignees: { select: { user: { select: { id: true, name: true } } } },
      reportTo: { select: { user: { select: { id: true, name: true } } } },
    },
  });
  // Own hours: subtract every live, visible sub-task (whether or not the filters keep it), like the charts.
  const childSums = rows.length
    ? await prisma.task.groupBy({
        by: ["parentTaskId"],
        where: { AND: [{ parentTaskId: { in: rows.map((r) => r.id) } }, visibleTaskWhere(user, allowed)] },
        _sum: { estimateMinutes: true, actualMinutes: true },
      })
    : [];
  const child = new Map(childSums.map((c) => [c.parentTaskId!, c._sum]));
  const tasks: ExportTask[] = rows.map((r) => {
    const c = child.get(r.id);
    return {
      id: r.id,
      workspace: r.workspace.name,
      workspaceSlug: r.workspace.slug,
      projectId: r.projectId,
      project: r.project.name,
      title: r.title,
      parent: r.parentTask && !r.parentTask.deletedAt ? r.parentTask.title : null,
      status: r.status.name,
      category: r.category?.name ?? null,
      priority: r.priority,
      assignees: r.assignees.map((a) => a.user),
      reportTo: r.reportTo.map((a) => a.user),
      startDate: r.startDate,
      dueDate: r.dueDate,
      completedAt: r.completedAt,
      estimateMinutes: r.estimateMinutes,
      actualMinutes: r.actualMinutes,
      ownEstimateMinutes: Math.max(0, (r.estimateMinutes ?? 0) - (c?.estimateMinutes ?? 0)),
      ownActualMinutes: Math.max(0, (r.actualMinutes ?? 0) - (c?.actualMinutes ?? 0)),
      progress: r.progress,
      createdAt: r.createdAt,
      createdBy: r.createdBy?.name ?? null,
    };
  });
  return { tasks, tooMany: false, count, workspaceIds: [...new Set(rows.map((r) => r.workspace.id))] };
}
