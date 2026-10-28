"use client";
import Link from "next/link";
import {
  Award,
  BarChart3,
  BookOpen,
  Bot,
  Brain,
  Building2,
  CircleHelp,
  Gauge,
  Home,
  Inbox,
  ListChecks,
  Palette,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Target,
  UserRound,
} from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { useShellNav } from "@/components/layout/shell-context";
import { useRecognitionUnread, useInbox } from "@/components/notifications/notification-bell";
import { MobileAppButton } from "@/components/pwa/mobile-app-prompt";
import { ProjectIcon } from "@/components/projects/project-icon";

type Icon = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;

const tile =
  "relative flex min-w-0 flex-col items-center justify-start gap-1.5 rounded-2xl px-1.5 py-3 text-center text-[11.5px] font-medium leading-tight text-neutral-700 active:bg-neutral-100 dark:text-neutral-200 dark:active:bg-neutral-800";
const iconBox = "flex h-11 w-11 items-center justify-center rounded-2xl";

function Tile({ href, icon: I, label, tint, badge, testId }: { href: string; icon: Icon; label: string; tint: string; badge?: number; testId?: string }) {
  return (
    <Link href={href} className={tile} data-testid={testId ?? "all-tile"}>
      <span className={`${iconBox} ${tint}`}>
        <I size={21} strokeWidth={1.9} />
      </span>
      <span className="line-clamp-2 break-words">{label}</span>
      {badge ? <span className="absolute right-2 top-2 min-w-4 rounded-full bg-rose-500 px-1 text-[9.5px] font-semibold leading-4 text-white">{badge > 99 ? "99+" : badge}</span> : null}
    </Link>
  );
}

function ActionTile({ onClick, icon: I, label, tint, testId }: { onClick: () => void; icon: Icon; label: string; tint: string; testId?: string }) {
  return (
    <button type="button" onClick={onClick} className={tile} data-testid={testId ?? "all-tile"}>
      <span className={`${iconBox} ${tint}`}>
        <I size={21} strokeWidth={1.9} />
      </span>
      <span className="line-clamp-2 break-words">{label}</span>
    </button>
  );
}

function Group({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
  return (
    <section className="rounded-2xl border border-neutral-200/80 bg-white p-2 dark:border-neutral-800 dark:bg-neutral-900" data-testid={testId}>
      <h2 className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">{title}</h2>
      <div className="grid grid-cols-4 gap-0.5 sm:grid-cols-6">{children}</div>
    </section>
  );
}

/**
 * The phone "All" tab: every feature of the menu as a button, grouped like the menu (Work,
 * Intelligence, Manage, Knowledge, Projects, More), so nothing is hidden behind the sidebar.
 */
export function AllFeatures() {
  const { t } = useT();
  const nav = useShellNav();
  const base = `/w/${nav.workspace.slug}`;
  const unread = useInbox((s) => s.unread);
  const recognitionUnread = useRecognitionUnread(nav.workspace.id);
  const tint = {
    indigo: "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-300",
    sky: "bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-300",
    violet: "bg-violet-50 text-violet-600 dark:bg-violet-950/60 dark:text-violet-300",
    emerald: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300",
    rose: "bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300",
    neutral: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  };

  return (
    <div className="flex-1 overflow-y-auto thin-scroll" data-testid="all-features">
      <div className="mx-auto max-w-3xl space-y-3 p-3 sm:p-5">
        <div className="flex items-center gap-2 px-1">
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-neutral-900 dark:text-neutral-50">{nav.workspace.name}</h1>
          <button type="button" onClick={nav.openSearch} className="shrink-0 rounded-full p-2 text-neutral-500 active:bg-neutral-100 dark:active:bg-neutral-800" aria-label={t("nav.searchPlaceholder")}>
            <Search size={18} />
          </button>
        </div>

        <Group title={t("nav.group.work")} testId="all-group-work">
          <Tile href={base} icon={Home} label={t("nav.home")} tint={tint.indigo} />
          <Tile href={`${base}/my-work`} icon={ListChecks} label={t("nav.myWork")} tint={tint.sky} />
          <Tile href={`${base}/inbox`} icon={Inbox} label={t("nav.inbox")} tint={tint.rose} badge={unread} testId="all-inbox" />
        </Group>

        <Group title={t("nav.group.intelligence")} testId="all-group-intelligence">
          <Tile href={`${base}/ai`} icon={Sparkles} label={t("nav.ai")} tint={tint.violet} />
          <Tile href={`${base}/agent-work`} icon={Bot} label={t("nav.agentWork")} tint={tint.violet} />
          <Tile href={`${base}/brain`} icon={Brain} label={t("nav.brain")} tint={tint.violet} />
          <Tile href={`${base}/dashboards`} icon={BarChart3} label={t("nav.reports")} tint={tint.sky} />
        </Group>

        <Group title={t("nav.group.manage")} testId="all-group-manage">
          <Tile href={`${base}/okrs`} icon={Target} label={t("nav.teamOkrs")} tint={tint.emerald} />
          <Tile href={`${base}/okrs/my`} icon={UserRound} label={t("nav.myOkrs")} tint={tint.emerald} />
          <Tile href={`${base}/okrs/dashboard`} icon={Gauge} label={t("nav.okrDashboard")} tint={tint.emerald} />
          <Tile href={`${base}/recognition`} icon={Award} label={t("nav.recognition")} tint={tint.amber} badge={recognitionUnread} />
        </Group>

        <Group title={t("nav.group.knowledge")} testId="all-group-knowledge">
          <Tile href={`${base}/wiki`} icon={BookOpen} label={t("nav.wiki")} tint={tint.amber} />
          {nav.wikis.map((w) => (
            <Link key={w.id} href={`${base}/wiki/${w.id}`} className={tile} data-testid="all-wiki">
              <span className={`${iconBox} ${tint.neutral} text-lg`}>{w.icon || <BookOpen size={21} strokeWidth={1.9} />}</span>
              <span className="line-clamp-2 break-words">{w.name}</span>
            </Link>
          ))}
        </Group>

        <Group title={t("nav.projects")} testId="all-group-projects">
          {nav.projects.map((p) => (
            <Link key={p.id} href={`${base}/p/${p.id}`} className={tile} data-testid="all-project">
              <span className={`${iconBox} ${tint.neutral}`}>
                <ProjectIcon icon={p.icon || "folder"} size={21} />
              </span>
              <span className="line-clamp-2 break-words">{p.name}</span>
            </Link>
          ))}
          {nav.canCreateProject ? <ActionTile onClick={nav.newProject} icon={Plus} label={t("nav.newProject")} tint={tint.indigo} testId="all-new-project" /> : null}
        </Group>

        <Group title={t("all.more")} testId="all-group-more">
          <Tile href={`${base}/settings`} icon={Settings} label={t("nav.settings")} tint={tint.neutral} />
          <ActionTile onClick={nav.openPreferences} icon={Palette} label={t("nav.preferences")} tint={tint.neutral} />
          <Tile href={`${base}/help`} icon={CircleHelp} label={t("nav.help")} tint={tint.neutral} />
          <Tile href="/workspaces" icon={Building2} label={t("ws.all")} tint={tint.neutral} />
          <MobileAppButton className={tile} testId="all-mobile-app">
            <span className={`${iconBox} ${tint.neutral}`}>
              <Smartphone size={21} strokeWidth={1.9} />
            </span>
            <span className="line-clamp-2 break-words">{t("mapp.open")}</span>
          </MobileAppButton>
          {nav.isAdmin ? <Tile href="/admin" icon={ShieldCheck} label={t("nav.adminConsole")} tint={tint.rose} /> : null}
        </Group>
      </div>
    </div>
  );
}
