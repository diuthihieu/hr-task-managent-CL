import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { visibleProjectWhere, visibleWikiWhere, hiddenProjectIds } from "@/lib/authz";
import { requireWorkspacePage } from "@/lib/page-context";
import { getServerT } from "@/lib/prefs";
import { getMyObjectiveRows, resolveObjectives, OBJECTIVE_INCLUDE } from "@/lib/okr-resolver";
import { NewProjectButton } from "@/components/projects/new-project-button";
import { visiblePageWhere } from "@/lib/wiki-sources";
import { Greeting } from "@/components/home/greeting";
import { type HomeTask } from "@/components/home/command-center";
import { HomeBoard } from "@/components/home/home-board";
import type { HomeData } from "@/components/home/home-widgets";
import { PRESETS } from "@/lib/home-widgets";
import { parseWidgets } from "@/lib/home-templates";
import { focusElapsed } from "@/lib/focus";


/** Server components render once per request, so "now" is the request time. */
const requestTime = () => new Date().getTime();
import type { MessageKey } from "@/lib/i18n/core";

export default async function WorkspaceHomePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const [{ user, workspace, role }, { t, locale }] = await Promise.all([requireWorkspacePage(workspaceSlug), getServerT()]);
  const visible = visibleProjectWhere(user);
  const base = `/w/${workspaceSlug}`;
  const today = new Date(new Date().toISOString().slice(0, 10));
  const now = requestTime();
  const monthAgo = new Date(now - 30 * 86400000);
  const mine = { workspaceId: workspace.id, deletedAt: null, project: { deletedAt: null, ...visible }, assignees: { some: { userId: user.id } } };
  const open = { status: { category: { in: ["todo", "in_progress"] as ("todo" | "in_progress")[] } } };

  const hidden = await hiddenProjectIds(user);
  const weekAgo = new Date(now - 7 * 86400000);
  const taskSelect = {
    id: true,
    title: true,
    priority: true,
    startDate: true,
    dueDate: true,
    progress: true,
    estimateMinutes: true,
    actualMinutes: true,
    completedAt: true,
    objectiveId: true,
    projectId: true,
    project: { select: { name: true, color: true, icon: true } },
    status: { select: { name: true, color: true, category: true } },
    assignees: { select: { user: { select: { id: true, name: true } } } },
    dependencies: { select: { dependsOn: { select: { title: true, deletedAt: true, status: { select: { category: true } } } } } },
  } as const;
  const focusFrom = new Date(today.getTime() - 6 * 86400000);
  const [projects, projectCounts, doneCounts, myDone, myTasks, waitingTasks, myOkrs, activity, focusRows, layout] = await Promise.all([
    prisma.project.findMany({ where: { workspaceId: workspace.id, deletedAt: null, ...visible }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.task.groupBy({ by: ["projectId"], where: { workspaceId: workspace.id, deletedAt: null, project: visible, ...open }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["projectId"], where: { workspaceId: workspace.id, deletedAt: null, project: visible, status: { category: "done" } }, _count: { _all: true } }),
    prisma.task.count({ where: { ...mine, status: { category: "done" }, completedAt: { gte: monthAgo } } }),
    // Every open task of mine + what I finished this week (the list scrolls).
    prisma.task.findMany({
      where: { ...mine, OR: [open, { status: { category: "done" }, completedAt: { gte: weekAgo } }] },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 1000,
      select: taskSelect,
    }),
    // Waiting for others: open work I created or receive reports on, done by someone else.
    prisma.task.findMany({
      where: {
        workspaceId: workspace.id,
        deletedAt: null,
        project: { deletedAt: null, ...visible },
        ...open,
        OR: [{ createdById: user.id }, { reportTo: { some: { userId: user.id } } }],
        assignees: { some: { userId: { not: user.id } }, none: { userId: user.id } },
      },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
      take: 50,
      select: taskSelect,
    }),
    getMyObjectiveRows(workspace.id, user.id, hidden),
    prisma.activityLog.findMany({ where: { workspaceId: workspace.id, entityType: { in: ["task", "project", "wiki_page", "objective"] } }, orderBy: { createdAt: "desc" }, take: 40, include: { actor: { select: { name: true, avatarColor: true } } } }),
    prisma.focusSession.findMany({ where: { userId: user.id, workspaceId: workspace.id, startedAt: { gte: focusFrom }, status: { not: "cancelled" } }, select: { startedAt: true, status: true, elapsedSeconds: true, resumedAt: true } }),
    prisma.homeLayout.findUnique({ where: { workspaceId_userId: { workspaceId: workspace.id, userId: user.id } } }),
  ]);

  // OKR widget: my objectives, else the workspace's.
  const okrs = myOkrs.length
    ? myOkrs
    : resolveObjectives(
        await prisma.objective.findMany({ where: { workspaceId: workspace.id, deletedAt: null, OR: [{ projectId: null }, { project: { deletedAt: null, ...visible } }] }, include: OBJECTIVE_INCLUDE, orderBy: { createdAt: "desc" }, take: 4 }),
        hidden
      );

  // Recent activity, limited to things this user can see.
  const ids = (type: string) => activity.filter((a) => a.entityType === type).map((a) => a.entityId);
  const [actTasks, actPages, actObjectives] = await Promise.all([
    prisma.task.findMany({ where: { id: { in: ids("task") }, project: visible }, select: { id: true, title: true, projectId: true } }),
    prisma.wikiPage.findMany({ where: { id: { in: ids("wiki_page") }, deletedAt: null, wiki: visibleWikiWhere(user, role), ...visiblePageWhere(hidden) }, select: { id: true, title: true, wikiId: true } }),
    prisma.objective.findMany({ where: { id: { in: ids("objective") }, deletedAt: null, OR: [{ projectId: null }, { project: visible }] }, select: { id: true, title: true } }),
  ]);
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const recent = activity
    .map((a) => {
      if (a.entityType === "task") {
        const x = actTasks.find((r) => r.id === a.entityId);
        return x && { a, label: x.title, href: `${base}/p/${x.projectId}/t/${x.id}` };
      }
      if (a.entityType === "wiki_page") {
        const x = actPages.find((r) => r.id === a.entityId);
        return x && { a, label: x.title, href: `${base}/wiki/${x.wikiId}/${x.id}` };
      }
      if (a.entityType === "objective") {
        const x = actObjectives.find((r) => r.id === a.entityId);
        return x && { a, label: x.title, href: `${base}/okrs/${x.id}` };
      }
      const p = projectById.get(a.entityId);
      return p && { a, label: p.name, href: `${base}/p/${p.id}` };
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .slice(0, 7);

  const toHome = (x: (typeof myTasks)[number]): HomeTask => ({
    id: x.id,
    title: x.title,
    projectId: x.projectId,
    projectName: x.project.name,
    projectColor: x.project.color,
    projectIcon: x.project.icon,
    statusName: x.status.name,
    statusColor: x.status.color,
    category: x.status.category,
    priority: x.priority,
    startDate: x.startDate ? x.startDate.toISOString().slice(0, 10) : null,
    dueDate: x.dueDate ? x.dueDate.toISOString().slice(0, 10) : null,
    progress: x.progress,
    estimateMinutes: x.estimateMinutes,
    actualMinutes: x.actualMinutes,
    blockedBy: x.dependencies.filter((d) => !d.dependsOn.deletedAt && (d.dependsOn.status.category === "todo" || d.dependsOn.status.category === "in_progress")).map((d) => d.dependsOn.title),
    completedAt: x.completedAt ? x.completedAt.toISOString() : null,
    okr: !!x.objectiveId,
    assigneeNames: x.assignees.filter((a) => a.user.id !== user.id).map((a) => a.user.name),
  });
  const todayStr = today.toISOString().slice(0, 10);
  const soonStr = new Date(today.getTime() + 3 * 86400000).toISOString().slice(0, 10);

  const openByProject = new Map(projectCounts.map((c) => [c.projectId, c._count._all]));
  const doneByProject = new Map(doneCounts.map((c) => [c.projectId, c._count._all]));
  const canCreate = ["owner", "admin", "editor"].includes(role);
  const firstName = locale === "vi" ? user.name.split(" ").slice(-1)[0] : user.name.split(" ")[0];
  const dateLabel = new Date().toLocaleDateString(locale === "vi" ? "vi-VN" : "en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  const focusByDay = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(focusFrom.getTime() + i * 86400000).toISOString().slice(0, 10);
    const seconds = focusRows.filter((f) => f.startedAt.toISOString().slice(0, 10) === date).reduce((sum, f) => sum + focusElapsed(f, new Date(now)), 0);
    return { date, minutes: Math.round(seconds / 60) };
  });
  const homeData: HomeData = {
    workspaceId: workspace.id,
    base,
    today: todayStr,
    soon: soonStr,
    locale,
    tasks: myTasks.map(toHome),
    waiting: waitingTasks.map(toHome),
    doneLast30: myDone,
    okrs: okrs.map((o) => ({ id: o.id, title: o.title, progress: o.progress, keyResults: o.keyResults.map((k) => ({ id: k.id, title: k.title, progress: k.progress })) })),
    okrsMine: myOkrs.length > 0,
    activity: recent.map(({ a, label, href }) => ({ id: a.id, actorName: a.actor?.name ?? null, actorColor: a.actor?.avatarColor ?? null, action: a.action, label, href, at: a.createdAt.toISOString() })),
    projects: projects.map((p) => {
      const openN = openByProject.get(p.id) ?? 0;
      const doneN = doneByProject.get(p.id) ?? 0;
      return { id: p.id, name: p.name, icon: p.icon, open: openN, pct: openN + doneN ? Math.round((doneN / (openN + doneN)) * 100) : 0 };
    }),
    canCreateProject: canCreate,
    focusByDay,
    now,
  };

  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <div className="max-w-[1240px] mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-neutral-900 dark:text-neutral-50">
              <Greeting name={firstName} />
            </h1>
            <p className="text-sm text-neutral-500 mt-0.5">{t("home.summary", { workspace: workspace.name, count: projects.length, role: t(`role.${role}` as MessageKey) })}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-400 hidden sm:block">{dateLabel}</span>
            <Link href={`${base}/ai`} className="inline-flex items-center gap-1.5 h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-sm font-medium text-neutral-700 dark:text-neutral-200 hover:border-indigo-300">
              <Sparkles size={14} className="text-indigo-600" /> {t("home.askAi")}
            </Link>
            {canCreate && <NewProjectButton workspaceId={workspace.id} workspaceSlug={workspace.slug} />}
          </div>
        </div>

        <Suspense>
          <HomeBoard data={homeData} initial={layout ? parseWidgets(layout.widgets) : PRESETS.command} custom={!!layout} role={role} />
        </Suspense>
      </div>
    </div>
  );
}
