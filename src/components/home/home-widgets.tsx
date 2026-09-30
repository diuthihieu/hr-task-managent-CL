"use client";
// Home widgets other than the command-center pieces: OKRs, activity, projects,
// deadlines, focus time, a single metric, an embedded dashboard and a note.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, ArrowUpRight, CalendarClock, FolderKanban, LayoutDashboard, StickyNote, Target, Timer, TrendingUp, Lock } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn, initials } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";
import { ProjectIcon } from "@/components/projects/project-icon";
import { WidgetCard, type DashboardBlockLite } from "@/components/dashboard/widget-card";
import type { MetricKey, WidgetConfig } from "@/lib/home-widgets";
import { classify, type HomeTask } from "./command-center";

export interface HomeOkr {
  id: string;
  title: string;
  progress: number;
  keyResults: { id: string; title: string; progress: number }[];
}
export interface HomeActivity {
  id: string;
  actorName: string | null;
  actorColor: string | null;
  action: string;
  label: string;
  href: string;
  at: string;
}
export interface HomeProject {
  id: string;
  name: string;
  icon: string | null;
  open: number;
  pct: number;
}
export interface HomeData {
  workspaceId: string;
  base: string;
  today: string;
  soon: string;
  locale: string;
  tasks: HomeTask[];
  waiting: HomeTask[];
  doneLast30: number;
  okrs: HomeOkr[];
  okrsMine: boolean;
  activity: HomeActivity[];
  projects: HomeProject[];
  canCreateProject: boolean;
  /** When the server rendered the page (relative times are computed from it, so hydration matches). */
  now: number;
  /** Focused minutes per day, oldest first (last 7 days). */
  focusByDay: { date: string; minutes: number }[];
}

export const CARD = "rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.03)]";

function Header({ icon: Icon, title, href, linkLabel }: { icon: typeof Target; title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h2 className="font-semibold text-neutral-900 dark:text-neutral-50 flex items-center gap-1.5 text-[15px]">
        <Icon size={15} className="text-indigo-600" /> {title}
      </h2>
      {href && (
        <Link href={href} className="text-xs font-medium text-indigo-600 hover:underline">
          {linkLabel}
        </Link>
      )}
    </div>
  );
}

export function Bar({ value, className }: { value: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const tone = v >= 70 ? "bg-emerald-500" : v >= 35 ? "bg-indigo-500" : "bg-amber-500";
  return (
    <div className={cn("rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden", className)}>
      <div className={cn("h-full rounded-full", tone)} style={{ width: `${v}%` }} />
    </div>
  );
}

function Ring({ value, size = 64, label, text }: { value: number; size?: number; label?: string; text?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const r = size / 2 - 5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" role="img" aria-label={label ?? `${Math.round(v)}%`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} className="stroke-neutral-100 dark:stroke-neutral-800" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} strokeLinecap="round" strokeDasharray={`${(v / 100) * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="stroke-indigo-500" />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="fill-neutral-800 dark:fill-neutral-100 text-[13px] font-bold">
        {text ?? `${Math.round(v)}%`}
      </text>
    </svg>
  );
}

export function OkrsWidget({ d, style }: { d: HomeData; style: string }) {
  const { t } = useT();
  return (
    <section className={cn(CARD, "p-5 h-full")} data-testid="home-okrs">
      <Header icon={Target} title={d.okrsMine ? t("nav.myOkrs") : t("nav.teamOkrs")} href={`${d.base}/okrs${d.okrsMine ? "/my" : ""}`} linkLabel={t("home.viewAll")} />
      {d.okrs.length === 0 && <p className="text-sm text-neutral-400">{t("home.noOkrs")}</p>}
      {style === "rings" ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {d.okrs.slice(0, 6).map((o) => (
            <Link key={o.id} href={`${d.base}/okrs/${o.id}`} className="flex flex-col items-center gap-2 rounded-xl border border-neutral-100 dark:border-neutral-800 p-3 hover:border-indigo-200 text-center">
              <Ring value={o.progress} />
              <span className="text-xs font-medium line-clamp-2">{o.title}</span>
              <span className="text-[10px] text-neutral-400">{t("home.krCount", { n: o.keyResults.length })}</span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {d.okrs.slice(0, 3).map((o) => (
            <div key={o.id}>
              <Link href={`${d.base}/okrs/${o.id}`} className="flex items-center gap-2 text-sm font-medium text-neutral-800 dark:text-neutral-100 hover:text-indigo-600">
                <span className="truncate flex-1">{o.title}</span>
                <span className="text-xs tabular-nums text-neutral-500">
                  <span className="text-[10px] text-neutral-400">{t("okr.progressShort")}</span> {Math.round(o.progress)}%
                </span>
              </Link>
              <Bar value={o.progress} className="mt-1.5 h-2" />
              {o.keyResults.slice(0, 3).map((k) => (
                <div key={k.id} className="flex items-center gap-2 mt-2 pl-3 text-xs text-neutral-500">
                  <span className="truncate flex-1">{k.title}</span>
                  <Bar value={k.progress} className="w-16 h-1.5" />
                  <span className="text-right tabular-nums whitespace-nowrap">
                    <span className="text-[10px] text-neutral-400">KR</span> {Math.round(k.progress)}%
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function useAgo(now: number) {
  const { t } = useT();
  return (iso: string) => {
    const m = Math.round((now - new Date(iso).getTime()) / 60000);
    if (m < 60) return t("notif.minutes", { count: Math.max(1, m) });
    if (m < 1440) return t("notif.hours", { count: Math.round(m / 60) });
    return t("notif.days", { count: Math.round(m / 1440) });
  };
}

export function ActivityWidget({ d, style }: { d: HomeData; style: string }) {
  const { t } = useT();
  const ago = useAgo(d.now);
  const label = (a: string) => (t(`home.act.${a}` as MessageKey) === `home.act.${a}` ? a : t(`home.act.${a}` as MessageKey));
  return (
    <section className={cn(CARD, "p-5 h-full")} data-testid="home-activity">
      <Header icon={Activity} title={t("home.activity")} />
      {d.activity.length === 0 && <p className="text-sm text-neutral-400">{t("home.noActivity")}</p>}
      <ul className={style === "compact" ? "space-y-1.5" : "space-y-3"}>
        {d.activity.slice(0, style === "compact" ? 10 : 7).map((a) =>
          style === "compact" ? (
            <li key={a.id} className="text-xs flex gap-1.5 min-w-0">
              <span className="font-semibold shrink-0">{a.actorName ?? t("notif.someone")}</span>
              <Link href={a.href} className="truncate text-neutral-600 dark:text-neutral-300 hover:text-indigo-600">
                {a.label}
              </Link>
              <span className="ml-auto text-neutral-400 shrink-0">{ago(a.at)}</span>
            </li>
          ) : (
            <li key={a.id} className="flex gap-2.5">
              <span className="h-7 w-7 rounded-full text-white text-[10px] font-semibold flex items-center justify-center shrink-0" style={{ backgroundColor: a.actorColor ?? "#a3a3a3" }}>
                {initials(a.actorName ?? "?")}
              </span>
              <span className="min-w-0 text-xs leading-5">
                <span className="font-semibold text-neutral-800 dark:text-neutral-100">{a.actorName ?? t("notif.someone")}</span> <span className="text-neutral-500">{label(a.action)}</span>{" "}
                <Link href={a.href} className="text-neutral-700 dark:text-neutral-300 hover:text-indigo-600 font-medium">
                  {a.label}
                </Link>
                <span className="block text-[11px] text-neutral-400">{ago(a.at)}</span>
              </span>
            </li>
          )
        )}
      </ul>
    </section>
  );
}

export function ProjectsWidget({ d, style }: { d: HomeData; style: string }) {
  const { t } = useT();
  const empty = (
    <div className={cn(CARD, "text-center py-14 text-neutral-400")}>
      <FolderKanban size={32} className="mx-auto mb-3 opacity-40" />
      <p>{t("home.noProjects")}</p>
      <p className="text-xs mt-1">{d.canCreateProject ? t("home.noProjectsHint") : t("home.noProjectsViewer")}</p>
    </div>
  );
  if (!d.projects.length) return empty;
  if (style === "list")
    return (
      <section className={cn(CARD, "p-5 h-full")} data-testid="home-projects">
        <Header icon={FolderKanban} title={t("nav.projects")} />
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {d.projects.map((p) => (
            <li key={p.id}>
              <Link href={`${d.base}/p/${p.id}`} className="flex items-center gap-3 py-2 hover:text-indigo-600">
                <ProjectIcon icon={p.icon} size={14} />
                <span className="flex-1 truncate text-sm font-medium">{p.name}</span>
                <span className="text-xs text-neutral-500 hidden sm:inline">{t("project.openTasks", { count: p.open })}</span>
                <Bar value={p.pct} className="w-24 h-1.5" />
                <span className="text-xs tabular-nums w-9 text-right">{p.pct}%</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <section data-testid="home-projects">
      <h2 className="font-semibold text-neutral-900 dark:text-neutral-50 mb-3">{t("nav.projects")}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {d.projects.map((p) => (
          <Link key={p.id} href={`${d.base}/p/${p.id}`} className={cn(CARD, "group p-4 hover:border-indigo-200 dark:hover:border-indigo-900 transition-colors")}>
            <div className="flex items-center gap-2.5">
              {p.icon && (
                <span className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 bg-indigo-50 dark:bg-indigo-950/60">
                  <ProjectIcon icon={p.icon} size={17} />
                </span>
              )}
              <span className="font-semibold text-neutral-900 dark:text-neutral-100 truncate flex-1">{p.name}</span>
              <ArrowUpRight size={15} className="text-neutral-300 group-hover:text-indigo-500" />
            </div>
            <div className="flex items-center justify-between mt-3 text-xs text-neutral-500">
              <span>{t("project.openTasks", { count: p.open })}</span>
              <span className="tabular-nums">{p.pct}%</span>
            </div>
            <Bar value={p.pct} className="mt-1.5 h-1.5" />
          </Link>
        ))}
      </div>
    </section>
  );
}

// Day names built by hand: server and browser ICU data can differ, which would break hydration.
const WD = { vi: { short: ["CN", "T2", "T3", "T4", "T5", "T6", "T7"], long: ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"] }, en: { short: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], long: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] } };
const MONTHS_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const wd = (date: string, locale: string, kind: "short" | "long") => WD[locale === "vi" ? "vi" : "en"][kind][new Date(`${date}T00:00:00Z`).getUTCDay()];
const dayMonth = (date: string, locale: string) => {
  const [, m, d] = date.split("-");
  return locale === "vi" ? `${d}/${m}` : `${d} ${MONTHS_EN[Number(m) - 1]}`;
};

const addDays = (date: string, n: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

/** Tracking: overdue work and what's due in the next two weeks. */
export function DeadlinesWidget({ d, style }: { d: HomeData; style: string }) {
  const { t } = useT();
  const until = addDays(d.today, 14);
  const open = d.tasks.filter((x) => classify(x, d.today, d.soon).open && x.dueDate && x.dueDate <= until).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
  const overdue = open.filter((x) => x.dueDate! < d.today);
  if (style === "strip") {
    const days = Array.from({ length: 7 }, (_, i) => addDays(d.today, i));
    return (
      <section className={cn(CARD, "p-5 h-full")} data-testid="home-deadlines">
        <Header icon={CalendarClock} title={t("home.w.deadlines")} />
        {overdue.length > 0 && <p className="text-xs text-red-600 mb-2">{t("home.overdueN", { n: overdue.length })}</p>}
        <div className="grid grid-cols-7 gap-1.5">
          {days.map((day) => {
            const due = open.filter((x) => x.dueDate === day);
            return (
              <div key={day} className={cn("rounded-lg border p-1.5 min-h-24", day === d.today ? "border-indigo-300 bg-indigo-50/40 dark:bg-indigo-950/20" : "border-neutral-100 dark:border-neutral-800")}>
                <div className="text-[10px] uppercase text-neutral-400">{wd(day, d.locale, "short")}</div>
                <div className="text-sm font-semibold">{day.slice(8)}</div>
                {due.slice(0, 3).map((x) => (
                  <Link key={x.id} href={`${d.base}/p/${x.projectId}/t/${x.id}`} className="block mt-1 text-[11px] leading-tight line-clamp-2 rounded bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200 px-1 py-0.5 hover:underline" title={x.title}>
                    {x.title}
                  </Link>
                ))}
                {due.length > 3 && <div className="text-[10px] text-neutral-400 mt-0.5">+{due.length - 3}</div>}
              </div>
            );
          })}
        </div>
      </section>
    );
  }
  const groups = new Map<string, HomeTask[]>();
  for (const x of open) {
    const key = x.dueDate! < d.today ? "overdue" : x.dueDate!;
    groups.set(key, [...(groups.get(key) ?? []), x]);
  }
  return (
    <section className={cn(CARD, "p-5 h-full flex flex-col")} data-testid="home-deadlines">
      <Header icon={CalendarClock} title={t("home.w.deadlines")} />
      {open.length === 0 && <p className="text-sm text-neutral-400">{t("home.noDeadlines")}</p>}
      <div className="space-y-3 max-h-80 overflow-y-auto thin-scroll">
        {[...groups.entries()].map(([key, items]) => (
          <div key={key}>
            <div className={cn("text-[11px] font-semibold uppercase tracking-wide mb-1", key === "overdue" ? "text-red-600" : key === d.today ? "text-indigo-600" : "text-neutral-500")}>
              {key === "overdue" ? t("cc.filter.overdue") : key === d.today ? t("home.today") : `${wd(key, d.locale, "long")}, ${dayMonth(key, d.locale)}`}
            </div>
            {items.map((x) => (
              <Link key={x.id} href={`${d.base}/p/${x.projectId}/t/${x.id}`} className="flex items-center gap-2 py-1 text-sm hover:text-indigo-600">
                <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: x.statusColor }} />
                <span className="truncate flex-1">{x.title}</span>
                <span className="text-[11px] text-neutral-400 truncate max-w-28">{x.projectName}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Tracking: focused time over the last 7 days. */
export function FocusTimeWidget({ d, style }: { d: HomeData; style: string }) {
  const { t } = useT();
  const total = d.focusByDay.reduce((s, x) => s + x.minutes, 0);
  const max = Math.max(30, ...d.focusByDay.map((x) => x.minutes));
  const hrs = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);
  return (
    <section className={cn(CARD, "p-5 h-full")} data-testid="home-focus-time">
      <Header icon={Timer} title={t("home.w.focus_time")} />
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-neutral-900 dark:text-neutral-50">{hrs(total)}</span>
        <span className="text-xs text-neutral-500">{t("home.last7days")}</span>
      </div>
      {style !== "number" && (
        <div className="mt-4 flex items-end gap-2 h-28" role="img" aria-label={t("home.w.focus_time")}>
          {d.focusByDay.map((x) => (
            <div key={x.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${x.date}: ${hrs(x.minutes)}`}>
              <div className={cn("w-full rounded-t-md", x.date === d.today ? "bg-indigo-600" : "bg-indigo-300 dark:bg-indigo-800")} style={{ height: `${Math.max(3, (x.minutes / max) * 100)}%` }} />
              <span className="text-[10px] text-neutral-400">{wd(x.date, d.locale, "short")}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function metricValue(d: HomeData, metric: MetricKey): { value: number; pct?: number; of?: number; alert?: boolean; href?: string } {
  const c = d.tasks.map((x) => classify(x, d.today, d.soon));
  const open = c.filter((x) => x.open).length;
  switch (metric) {
    case "open":
      return { value: open, of: open, href: "?tasks=open#my-tasks" };
    case "in_progress":
      return { value: d.tasks.filter((x) => x.category === "in_progress").length, of: open, href: "?tasks=in_progress#my-tasks" };
    case "overdue": {
      const n = c.filter((x) => x.overdue).length;
      return { value: n, of: open, alert: n > 0, href: "?tasks=overdue#my-tasks" };
    }
    case "due_today":
      return { value: c.filter((x) => x.dueToday).length, of: open, href: "?tasks=today#my-tasks" };
    case "done_30d":
      return { value: d.doneLast30, href: "?tasks=done#my-tasks" };
    case "completion_rate": {
      const pct = d.doneLast30 + open ? Math.round((d.doneLast30 / (d.doneLast30 + open)) * 100) : 0;
      return { value: pct, pct };
    }
    case "focus_week":
      return { value: Math.round((d.focusByDay.reduce((s, x) => s + x.minutes, 0) / 60) * 10) / 10 };
    case "waiting":
      return { value: d.waiting.length };
  }
}

export function MetricWidget({ d, style, config }: { d: HomeData; style: string; config?: WidgetConfig }) {
  const { t } = useT();
  const metric = config?.metric ?? "overdue";
  const m = metricValue(d, metric);
  const label = config?.title || t(`home.metric.${metric}` as MessageKey);
  const unit = metric === "completion_rate" ? "%" : metric === "focus_week" ? "h" : "";
  const body =
    style === "ring" ? (
      <div className="flex items-center gap-4">
        {/* Counts are drawn as a share of your open work; percentages as themselves. */}
        <Ring value={m.pct ?? (m.of ? (m.value / m.of) * 100 : 0)} size={72} label={label} text={m.pct === undefined ? `${m.value}${unit}` : undefined} />
        <div className="min-w-0">
          <div className="text-xs text-neutral-500">{label}</div>
          <div className="text-2xl font-bold tabular-nums">
            {m.value}
            {unit}
          </div>
        </div>
      </div>
    ) : style === "big" ? (
      <div>
        <div className={cn("text-5xl font-extrabold tabular-nums tracking-tight", m.alert ? "text-red-600" : "text-indigo-600")}>
          {m.value}
          <span className="text-2xl">{unit}</span>
        </div>
        <div className="mt-1 text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</div>
      </div>
    ) : (
      <div className="flex items-center gap-3">
        <span className={cn("h-11 w-11 rounded-xl flex items-center justify-center shrink-0", m.alert ? "bg-red-50 text-red-600 dark:bg-red-950" : "bg-indigo-50 text-indigo-600 dark:bg-indigo-950")}>
          <TrendingUp size={20} />
        </span>
        <span className="min-w-0">
          <span className="block text-xs text-neutral-500 truncate">{label}</span>
          <span className={cn("block text-2xl font-bold tabular-nums", m.alert && "text-red-600")}>
            {m.value}
            {unit}
          </span>
        </span>
      </div>
    );
  const cls = cn(CARD, "p-4 h-full block hover:border-indigo-200 dark:hover:border-indigo-900");
  return m.href ? (
    <Link href={m.href} className={cls} data-testid="home-metric" data-metric={metric}>
      {body}
    </Link>
  ) : (
    <div className={cls} data-testid="home-metric" data-metric={metric}>
      {body}
    </div>
  );
}

interface DashboardDetail {
  id: string;
  name: string;
  blocks: DashboardBlockLite[];
}

/** An existing dashboard (or one of its charts), read-only; access is checked by the dashboard API. */
export function DashboardWidget({ d, style, config }: { d: HomeData; style: string; config?: WidgetConfig }) {
  const { t } = useT();
  const [dash, setDash] = useState<DashboardDetail | null>(null);
  const [error, setError] = useState<"none" | "denied" | null>(null);
  useEffect(() => {
    if (!config?.dashboardId) return;
    let alive = true;
    api
      .get<DashboardDetail>(`/api/dashboards/${config.dashboardId}`)
      .then((x) => alive && (setDash(x), setError(null)))
      .catch(() => alive && setError("denied"));
    return () => {
      alive = false;
    };
  }, [config?.dashboardId]);
  const blocks = useMemo(() => {
    if (!dash) return [];
    if (style === "single") return dash.blocks.filter((b) => b.id === config?.blockId).concat(dash.blocks).slice(0, 1);
    return dash.blocks.slice(0, 4);
  }, [dash, style, config?.blockId]);
  if (!config?.dashboardId)
    return (
      <div className={cn(CARD, "p-6 h-full flex flex-col items-center justify-center text-center text-sm text-neutral-500 gap-2")} data-testid="home-dashboard">
        <LayoutDashboard size={22} className="text-indigo-500" /> {t("home.dash.pick")}
      </div>
    );
  if (error)
    return (
      <div className={cn(CARD, "p-6 h-full flex items-center justify-center gap-2 text-sm text-neutral-500")} data-testid="home-dashboard">
        <Lock size={14} /> {t("home.dash.noAccess")}
      </div>
    );
  return (
    <section className={cn(CARD, "p-4 h-full")} data-testid="home-dashboard">
      <Header icon={LayoutDashboard} title={config.title || dash?.name || t("home.w.dashboard")} href={dash ? `${d.base}/dash/${dash.id}` : undefined} linkLabel={t("home.dash.open")} />
      {!dash ? (
        <div className="h-48 rounded-lg bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
      ) : blocks.length === 0 ? (
        <p className="text-sm text-neutral-400">{t("home.dash.empty")}</p>
      ) : (
        <div className={cn("grid gap-3", style === "single" ? "grid-cols-1" : "sm:grid-cols-2")}>
          {blocks.map((b) => (
            <div key={b.id} className={style === "single" ? "h-72" : "h-56"}>
              <WidgetCard block={b} fieldNameLookup={() => undefined} onEdit={() => {}} onDelete={() => {}} readOnly />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function NoteWidget({ style, config }: { style: string; config?: WidgetConfig }) {
  const { t } = useT();
  return (
    <section className={cn("h-full rounded-2xl p-4", style === "sticky" ? "bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rotate-[-0.4deg]" : CARD)} data-testid="home-note">
      <div className="flex items-center gap-1.5 text-sm font-semibold mb-2 text-neutral-800 dark:text-neutral-100">
        <StickyNote size={14} className={style === "sticky" ? "text-amber-600" : "text-indigo-600"} /> {config?.title || t("home.w.note")}
      </div>
      <p className="text-sm whitespace-pre-wrap text-neutral-700 dark:text-neutral-200 break-words">{config?.text || <span className="text-neutral-400">{t("home.note.empty")}</span>}</p>
    </section>
  );
}
