import Link from "next/link";
import { ClipboardList, Loader, CheckCircle2, AlarmClock, ArrowUpRight, FolderKanban, Target, Activity, Sparkles } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { visibleProjectWhere, visibleWikiWhere, hiddenProjectIds } from "@/lib/authz";
import { requireWorkspacePage } from "@/lib/page-context";
import { getServerT } from "@/lib/prefs";
import { getMyObjectiveRows, resolveObjectives, OBJECTIVE_INCLUDE } from "@/lib/okr-resolver";
import { NewProjectButton } from "@/components/projects/new-project-button";
import { Greeting } from "@/components/home/greeting";
import { cn, initials } from "@/lib/utils";

/** Server components render once per request, so "now" is the request time. */
const requestTime = () => new Date().getTime();
import type { MessageKey } from "@/lib/i18n/core";

const PRIORITY_STYLE: Record<string, string> = {
  critical: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  high: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  medium: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  low: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
};

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
  const [projects, projectCounts, doneCounts, myOpen, myInProgress, myDone, myOverdue, myTasks, myOkrs, activity] = await Promise.all([
    prisma.project.findMany({ where: { workspaceId: workspace.id, deletedAt: null, ...visible }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.task.groupBy({ by: ["projectId"], where: { workspaceId: workspace.id, deletedAt: null, project: visible, ...open }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["projectId"], where: { workspaceId: workspace.id, deletedAt: null, project: visible, status: { category: "done" } }, _count: { _all: true } }),
    prisma.task.count({ where: { ...mine, ...open } }),
    prisma.task.count({ where: { ...mine, status: { category: "in_progress" } } }),
    prisma.task.count({ where: { ...mine, status: { category: "done" }, completedAt: { gte: monthAgo } } }),
    prisma.task.count({ where: { ...mine, ...open, dueDate: { lt: today } } }),
    prisma.task.findMany({
      where: { ...mine, ...open },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
      take: 7,
      select: { id: true, title: true, priority: true, dueDate: true, progress: true, projectId: true, project: { select: { name: true, color: true } }, status: { select: { name: true, color: true } } },
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
  const kpis = [
    { label: t("home.kpi.open"), value: myOpen, icon: ClipboardList, tone: "bg-sky-50 text-sky-600 dark:bg-sky-950 dark:text-sky-300", href: `${base}/my-work` },
    { label: t("home.kpi.inProgress"), value: myInProgress, icon: Loader, tone: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300", href: `${base}/my-work` },
    { label: t("home.kpi.done"), value: myDone, icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-300", href: `${base}/my-work` },
    { label: t("home.kpi.overdue"), value: myOverdue, icon: AlarmClock, tone: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300", href: `${base}/my-work`, alert: myOverdue > 0 },
  ];
  const card = "rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.03)]";

  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <div className="max-w-[1240px] mx-auto px-6 py-6 space-y-5">
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

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="home-kpis">
          {kpis.map((k) => (
            <Link key={k.label} href={k.href} className={cn(card, "p-4 flex items-center gap-3 hover:border-indigo-200 dark:hover:border-indigo-900 transition-colors")}>
              <span className={cn("h-11 w-11 rounded-xl flex items-center justify-center shrink-0", k.tone)}>
                <k.icon size={20} />
              </span>
              <span className="min-w-0">
                <span className="block text-xs text-neutral-500 truncate">{k.label}</span>
                <span className={cn("block text-2xl font-bold tabular-nums", k.alert ? "text-red-600" : "text-neutral-900 dark:text-neutral-50")}>{k.value}</span>
              </span>
            </Link>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
          <section className={cn(card, "overflow-hidden")}>
            <div className="flex items-center justify-between px-5 pt-4 pb-3">
              <h2 className="font-semibold text-neutral-900 dark:text-neutral-50">{t("home.myTasks")}</h2>
              <Link href={`${base}/my-work`} className="text-xs font-medium text-indigo-600 hover:underline">{t("home.viewAll")}</Link>
            </div>
            {myTasks.length === 0 ? (
              <div className="px-5 pb-8 pt-4 text-sm text-neutral-400 text-center">{t("home.noTasks")}</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-neutral-400 border-y border-neutral-100 dark:border-neutral-800">
                    <th className="text-left font-medium px-5 py-2">{t("home.col.task")}</th>
                    <th className="text-left font-medium px-2 py-2 hidden md:table-cell">{t("home.col.project")}</th>
                    <th className="text-left font-medium px-2 py-2">{t("home.col.priority")}</th>
                    <th className="text-left font-medium px-2 py-2">{t("home.col.due")}</th>
                    <th className="text-left font-medium px-5 py-2 hidden xl:table-cell">{t("home.col.progress")}</th>
                  </tr>
                </thead>
                <tbody>
                  {myTasks.map((task) => {
                    const overdue = task.dueDate && task.dueDate < today;
                    return (
                      <tr key={task.id} className="border-b last:border-0 border-neutral-100 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/40">
                        <td className="px-5 py-2.5">
                          <Link href={`${base}/p/${task.projectId}/t/${task.id}`} className="flex items-center gap-2 min-w-0">
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: task.status.color }} title={task.status.name} />
                            <span className="truncate font-medium text-neutral-800 dark:text-neutral-100 hover:text-indigo-600">{task.title}</span>
                          </Link>
                        </td>
                        <td className="px-2 py-2.5 hidden md:table-cell">
                          <span className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 max-w-40">
                            <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: task.project.color }} />
                            <span className="truncate">{task.project.name}</span>
                          </span>
                        </td>
                        <td className="px-2 py-2.5">
                          <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", PRIORITY_STYLE[task.priority] ?? PRIORITY_STYLE.medium)}>{t(`okr.priority.${task.priority}` as MessageKey)}</span>
                        </td>
                        <td className={cn("px-2 py-2.5 text-xs whitespace-nowrap", overdue ? "text-red-600 font-medium" : "text-neutral-500")}>
                          {task.dueDate ? task.dueDate.toLocaleDateString(locale === "vi" ? "vi-VN" : "en-GB", { day: "2-digit", month: "short", timeZone: "UTC" }) : "—"}
                        </td>
                        <td className="px-5 py-2.5 hidden xl:table-cell">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-20 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                              <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${task.progress}%` }} />
                            </div>
                            <span className="text-[11px] text-neutral-400 tabular-nums">{task.progress}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <div className="space-y-5">
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
                      <span className="text-xs tabular-nums text-neutral-500">{Math.round(o.progress)}%</span>
                    </Link>
                    <Bar value={o.progress} className="mt-1.5 h-2" />
                    {o.keyResults.slice(0, 3).map((k) => (
                      <div key={k.id} className="flex items-center gap-2 mt-2 pl-3 text-xs text-neutral-500">
                        <span className="truncate flex-1">{k.title}</span>
                        <Bar value={k.progress} className="w-16 h-1.5" />
                        <span className="w-8 text-right tabular-nums">{Math.round(k.progress)}%</span>
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
          </div>
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
