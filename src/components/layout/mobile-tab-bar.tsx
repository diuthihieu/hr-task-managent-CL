"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import * as RDialog from "@radix-ui/react-dialog";
import { FolderKanban, Home, Inbox, ListChecks, Menu, Plus, X } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { useInbox } from "@/components/notifications/notification-bell";
import { ProjectIcon } from "@/components/projects/project-icon";
import { cn } from "@/lib/utils";

export type MobileTab = "home" | "myWork" | "projects" | "inbox" | null;

/**
 * Phone / tablet navigation: tabs at the bottom of the screen like a native app (Home, My work,
 * Projects, Action center, More). "Projects" opens a sheet with the projects; "More" opens the full
 * menu (the sidebar drawer). Hidden from the lg breakpoint up, where the sidebar is always shown.
 */
export function MobileTabBar({
  workspaceSlug,
  active,
  projects,
  activeProjectId,
  canCreateProject,
  onNewProject,
  onMore,
}: {
  workspaceSlug: string;
  active: MobileTab;
  projects: { id: string; name: string; icon: string | null }[];
  activeProjectId?: string;
  canCreateProject: boolean;
  onNewProject: () => void;
  onMore: () => void;
}) {
  const { t } = useT();
  const unread = useInbox((s) => s.unread);
  const [projectsOpen, setProjectsOpen] = useState(false);

  // Fixed elements (AI button, toasts, pop-ups) sit above the bar while it is shown.
  useEffect(() => {
    document.body.classList.add("has-bottom-nav");
    // iOS scrolls the whole page up to show a focused field above the keyboard and may leave it there
    // after the keyboard closes, pushing the tabs off screen: put the page back once typing ends.
    const reset = () =>
      window.setTimeout(() => {
        const el = document.activeElement;
        const typing = el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
        if (!typing && (window.scrollY !== 0 || document.documentElement.scrollTop !== 0)) window.scrollTo(0, 0);
      }, 120);
    document.addEventListener("focusout", reset);
    window.visualViewport?.addEventListener("resize", reset);
    return () => {
      document.body.classList.remove("has-bottom-nav");
      document.removeEventListener("focusout", reset);
      window.visualViewport?.removeEventListener("resize", reset);
    };
  }, []);

  const base = `/w/${workspaceSlug}`;
  const item = (on: boolean) =>
    cn("relative flex flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 pb-1 text-[10.5px] font-medium", on ? "text-indigo-600 dark:text-indigo-300" : "text-neutral-500 dark:text-neutral-400");
  const bar = (on: boolean) => (on ? <span className="absolute top-0 h-0.5 w-8 rounded-full bg-indigo-600 dark:bg-indigo-400" aria-hidden /> : null);

  return (
    <>
      <nav
        className="lg:hidden shrink-0 border-t border-neutral-200 bg-white/95 backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label={t("nav.menu")}
        data-testid="mobile-tab-bar"
      >
        <div className="flex h-14 items-stretch">
          <Link href={base} className={item(active === "home")} aria-current={active === "home" ? "page" : undefined} data-testid="tab-home">
            {bar(active === "home")}
            <Home size={20} strokeWidth={active === "home" ? 2.2 : 1.8} />
            {t("nav.home")}
          </Link>
          <Link href={`${base}/my-work`} className={item(active === "myWork")} aria-current={active === "myWork" ? "page" : undefined} data-testid="tab-my-work">
            {bar(active === "myWork")}
            <ListChecks size={20} strokeWidth={active === "myWork" ? 2.2 : 1.8} />
            {t("tab.myWork")}
          </Link>
          <button type="button" onClick={() => setProjectsOpen(true)} className={item(active === "projects")} data-testid="tab-projects">
            {bar(active === "projects")}
            <FolderKanban size={20} strokeWidth={active === "projects" ? 2.2 : 1.8} />
            {t("nav.projects")}
          </button>
          <Link href={`${base}/inbox`} className={item(active === "inbox")} aria-current={active === "inbox" ? "page" : undefined} data-testid="tab-inbox">
            {bar(active === "inbox")}
            <span className="relative">
              <Inbox size={20} strokeWidth={active === "inbox" ? 2.2 : 1.8} />
              {unread > 0 ? (
                <span className="absolute -right-2.5 -top-1.5 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[9.5px] font-semibold leading-4 text-white" data-testid="tab-inbox-badge">
                  {unread > 99 ? "99+" : unread}
                </span>
              ) : null}
            </span>
            {t("tab.inbox")}
          </Link>
          <button type="button" onClick={onMore} className={item(false)} data-testid="tab-more">
            <Menu size={20} strokeWidth={1.8} />
            {t("tab.more")}
          </button>
        </div>
      </nav>

      <RDialog.Root open={projectsOpen} onOpenChange={setProjectsOpen}>
        <RDialog.Portal>
          <RDialog.Overlay className="fixed inset-0 z-50 bg-black/40 lg:hidden" />
          <RDialog.Content
            className="fixed inset-x-0 bottom-0 z-50 max-h-[75vh] overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-neutral-900 lg:hidden flex flex-col"
            style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
            data-testid="projects-sheet"
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" aria-hidden />
            <div className="flex items-center gap-2 px-4 pb-2 pt-3">
              <RDialog.Title className="flex-1 text-base font-semibold text-neutral-900 dark:text-neutral-50">{t("nav.projects")}</RDialog.Title>
              {canCreateProject ? (
                <button
                  type="button"
                  onClick={() => {
                    setProjectsOpen(false);
                    onNewProject();
                  }}
                  className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white"
                >
                  <Plus size={13} /> {t("nav.newProject")}
                </button>
              ) : null}
              <RDialog.Close className="rounded-full p-1.5 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t("common.close")}>
                <X size={16} />
              </RDialog.Close>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-3 thin-scroll">
              {projects.length === 0 ? <p className="px-3 py-6 text-center text-sm text-neutral-400">{t("nav.noProjects")}</p> : null}
              {projects.map((p) => (
                <Link
                  key={p.id}
                  href={`${base}/p/${p.id}`}
                  onClick={() => setProjectsOpen(false)}
                  className={cn("flex items-center gap-3 rounded-xl px-3 py-3 text-[15px]", activeProjectId === p.id ? "bg-indigo-50 font-semibold text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300" : "text-neutral-800 active:bg-neutral-100 dark:text-neutral-100 dark:active:bg-neutral-800")}
                  data-testid="sheet-project"
                >
                  <ProjectIcon icon={p.icon} size={18} />
                  <span className="truncate">{p.name}</span>
                </Link>
              ))}
            </div>
          </RDialog.Content>
        </RDialog.Portal>
      </RDialog.Root>
    </>
  );
}
