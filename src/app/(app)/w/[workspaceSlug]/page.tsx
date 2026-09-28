import Link from "next/link";
import { ArrowUpRight, FolderKanban, Target, Activity, Sparkles } from "lucide-react";
import { Suspense } from "react";
import { prisma } from "@/lib/prisma";
import { visibleProjectWhere, visibleWikiWhere, hiddenProjectIds } from "@/lib/authz";
import { requireWorkspacePage } from "@/lib/page-context";
import { getServerT } from "@/lib/prefs";
import { getMyObjectiveRows, resolveObjectives, OBJECTIVE_INCLUDE } from "@/lib/okr-resolver";
import { NewProjectButton } from "@/components/projects/new-project-button";
import { Greeting } from "@/components/home/greeting";
import { CommandCenter, type HomeTask } from "@/components/home/command-center";
import { cn, initials } from "@/lib/utils";

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
    project: { select: { name: true, color: true } },
    status: { select: { name: true, color: true, category: true } },
    assignees: { select: { user: { select: { id: true, name: true } } } },
    dependencies: { select: { dependsOn: { select: { title: true, deletedAt: true, status: { select: { category: true } } } } } },
  } as const;
  const [projects, projectCounts, doneCounts, myDone, myTasks, waitingTasks, myOkrs, activity] = await Promise.all([
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
    prisma.wikiPage.findMany({ where: { id: { in: ids("wiki_page") }, deletedAt: null, wiki: visibleWikiWhere(user, role) }, select: { id: true, title: true, wikiId: true } }),
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
  const ago = (d: Date) => {
    const m = Math.round((now - d.getTime()) / 60000);
    if (m < 60) return t("notif.minutes", { count: Math.max(1, m) });
    if (m < 1440) return t("notif.hours", { count: Math.round(m / 60) });
    return t("notif.days", { count: Math.round(m / 1440) });
  };
  const card = "rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.03)]";

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
          <CommandCenter workspaceId={workspace.id} base={base} today={todayStr} soon={soonStr} locale={locale} tasks={myTasks.map(toHome)} waiting={waitingTasks.map(toHome)} doneLast30={myDone} />
        </Suspense>

        <div className="grid gap-5 lg:grid-cols-2">
          <>
            <section className={cn(card, "p-5")} data-testid="home-okrs">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold text-neutral-900 dark:text-neutral-50 flex items-center gap-1.5">
                  <Target size={15} className="text-indigo-600" /> {myOkrs.length ? t("nav.myOkrs") : t("nav.teamOkrs")}
                </h2>
                <Link href={`${base}/okrs${myOkrs.length ? "/my" : ""}`} className="text-xs font-medium text-indigo-600 hover:underline">{t("home.viewAll")}</Link>
              </div>
              {okrs.length === 0 && <p className="text-sm text-neutral-400">{t("home.noOkrs")}</p>}
              <div className="space-y-4">
                {okrs.slice(0, 3).map((o) => (
                  <div key={o.id}>
                    <Link href={`${base}/okrs/${o.id}`} className="flex items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-100 hover:text-indigo-600">
                      <span className="truncate flex-1">{o.title}</span>
                      <span className="text-xs tabular-nums text-neutral-500"><span className="text-[10px] text-neutral-400">{t("okr.progressShort")}</span> {Math.round(o.progress)}%</span>
                    </Link>
                    <Bar value={o.progress} className="mt-1.5 h-2" />
                    {o.keyResults.slice(0, 3).map((k) => (
                      <div key={k.id} className="flex items-center gap-2 mt-2 pl-3 text-xs text-neutral-500">
                        <span className="truncate flex-1">{k.title}</span>
                        <Bar value={k.progress} className="w-16 h-1.5" />
                        <span className="text-right tabular-nums whitespace-nowrap"><span className="text-[10px] text-neutral-400">KR</span> {Math.round(k.progress)}%</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>

            <section className={cn(card, "p-5")} data-testid="home-activity">
              <h2 className="font-semibold text-neutral-900 dark:text-neutral-50 flex items-center gap-1.5 mb-3">
                <Activity size={15} className="text-indigo-600" /> {t("home.activity")}
              </h2>
              {recent.length === 0 && <p className="text-sm text-neutral-400">{t("home.noActivity")}</p>}
              <ul className="space-y-3">
                {recent.map(({ a, label, href }) => (
                  <li key={a.id} className="flex gap-2.5">
                    <span className="h-7 w-7 rounded-full text-white text-[10px] font-semibold flex items-center justify-center shrink-0" style={{ backgroundColor: a.actor?.avatarColor ?? "#a3a3a3" }}>
                      {initials(a.actor?.name ?? "?")}
                    </span>
                    <span className="min-w-0 text-xs leading-5">
                      <span className="font-semibold text-neutral-800 dark:text-neutral-100">{a.actor?.name ?? t("notif.someone")}</span>{" "}
                      <span className="text-neutral-500">{t(`home.act.${a.action}` as MessageKey) === `home.act.${a.action}` ? a.action : t(`home.act.${a.action}` as MessageKey)}</span>{" "}
                      <Link href={href} className="text-neutral-700 dark:text-neutral-300 hover:text-indigo-600 font-medium">{label}</Link>
                      <span className="block text-[11px] text-neutral-400">{ago(a.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        </div>

        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-50">{t("nav.projects")}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {projects.map((p) => {
              const openN = openByProject.get(p.id) ?? 0;
              const doneN = doneByProject.get(p.id) ?? 0;
              const pct = openN + doneN ? Math.round((doneN / (openN + doneN)) * 100) : 0;
              return (
                <Link key={p.id} href={`${base}/p/${p.id}`} className={cn(card, "group p-4 hover:border-indigo-200 dark:hover:border-indigo-900 transition-colors")}>
                  <div className="flex items-center gap-2.5">
                    <span className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${p.color}1f`, color: p.color }}>
                      <FolderKanban size={17} />
                    </span>
                    <span className="font-semibold text-neutral-900 dark:text-neutral-100 truncate flex-1">{p.name}</span>
                    <ArrowUpRight size={15} className="text-neutral-300 group-hover:text-indigo-500" />
                  </div>
                  <div className="flex items-center justify-between mt-3 text-xs text-neutral-500">
                    <span>{t("project.openTasks", { count: openN })}</span>
                    <span className="tabular-nums">{pct}%</span>
                  </div>
                  <Bar value={pct} className="mt-1.5 h-1.5" />
                </Link>
              );
            })}
          </div>
          {projects.length === 0 && (
            <div className={cn(card, "text-center py-14 text-neutral-400")}>
              <FolderKanban size={32} className="mx-auto mb-3 opacity-40" />
              <p>{t("home.noProjects")}</p>
              <p className="text-xs mt-1">{canCreate ? t("home.noProjectsHint") : t("home.noProjectsViewer")}</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Bar({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const tone = v >= 70 ? "bg-emerald-500" : v >= 35 ? "bg-indigo-500" : "bg-amber-500";
  return (
    <div className={cn("rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden", className)}>
      <div className={cn("h-full rounded-full", tone)} style={{ width: `${v}%` }} />
    </div>
  );
}
