"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { NotificationBell, RecognitionCount, UnreadCount } from "@/components/notifications/notification-bell";
import { WorkspaceAvatar } from "@/components/workspaces/workspace-avatar";
import { emitViewsChanged } from "@/lib/view-events";
import { FocusDock } from "@/components/focus/focus-mode";
import { AgentSuggestionPopup } from "@/components/agent-work/agent-suggestion-popup";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  KeyRound,
  MonitorDown,
  Plus,
  Settings,
  Sheet,
  Kanban as KanbanIcon,
  Calendar as CalendarIcon,
  Clock3,
  GanttChartSquare,
  GalleryHorizontal,
  FileInput,
  Grid2x2,
  Search,
  Menu,
  UserCircle,
  Sun,
  Moon,
  LogOut,
  Target,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  GripVertical,
  BarChart3,
  Target as TargetIcon,
  BookOpen,
  Brain,
  Bot,
  Award,
  SlidersHorizontal,
  Palette,
  Building2,
  Home,
  ListChecks,
  Inbox,
  Sparkles,
  Lock,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { PreferencesDialog } from "@/components/preferences/preferences-dialog";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
import { ProjectIcon } from "@/components/projects/project-icon";
import type { MessageKey } from "@/lib/i18n/core";
import { useTheme } from "@/components/theme-provider";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { initials, cn } from "@/lib/utils";
import { CommandPalette } from "./command-palette";
import { useDesktopVersion } from "@/components/desktop/use-desktop";

const VIEW_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  grid: Sheet,
  kanban: KanbanIcon,
  calendar: CalendarIcon,
  gantt: GanttChartSquare,
  gallery: GalleryHorizontal,
  form: FileInput,
  eisenhower: Grid2x2,
  report: BarChart3,
};
export const NEW_VIEW_TYPES: { type: string; label: MessageKey }[] = [
  { type: "grid", label: "view.type.grid" },
  { type: "kanban", label: "view.type.kanban" },
  { type: "calendar", label: "view.type.calendar" },
  { type: "gantt", label: "view.type.gantt" },
  { type: "eisenhower", label: "view.type.eisenhower" },
  { type: "gallery", label: "view.type.gallery" },
  { type: "form", label: "view.type.form" },
  { type: "report", label: "view.type.report" },
];

interface ViewLite { id: string; name: string; type: string; canDelete: boolean }
interface ProjectLite { id: string; name: string; color: string; icon: string | null; views: ViewLite[] }
interface WorkspaceLite { id: string; name: string; slug: string; logoUrl?: string | null }

const ROLE_RANK: Record<string, number> = { viewer: 0, contributor: 1, editor: 2, admin: 3, owner: 4 };

interface WikiLite { id: string; name: string; icon: string | null; color: string; access: string }

export function WorkspaceShell({
  workspace,
  workspaces,
  wikis,
  projects,
  user,
  role,
  children,
}: {
  workspace: WorkspaceLite;
  workspaces: WorkspaceLite[];
  wikis: WikiLite[];
  projects: ProjectLite[];
  user: { id: string; name: string; email: string; systemRole: "ADMIN" | "MEMBER"; avatarColor: string; avatarUrl?: string | null };
  role: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { t } = useT();
  // Projects and wikis stay collapsed except the one you are in; a click overrides that.
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());
  const isProjectOpen = (id: string) => toggled.get(id) ?? id === activeProjectId;
  const [wikiOpen, setWikiOpen] = useState<boolean | null>(null);
  // Compact (icon-only) sidebar on desktop, and the dismissible desktop-app link: per-viewer conveniences.
  const [compact, setCompact] = useState(false);
  const [promoHidden, setPromoHidden] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore per-viewer sidebar prefs after hydration
    setCompact(readPref("woli.sidebar.compact") === "1");
    setPromoHidden(readPref("woli.sidebar.promo") === "hidden");
  }, []);
  const toggleCompact = () => {
    setCompact((c) => {
      writePref("woli.sidebar.compact", c ? "0" : "1");
      return !c;
    });
  };
  const hidePromo = () => {
    writePref("woli.sidebar.promo", "hidden");
    setPromoHidden(true);
  };
  // Mobile / small tablet: the sidebar is an off-canvas drawer, closed on navigation.
  const [navOpen, setNavOpen] = useState(false);
  const [navPath, setNavPath] = useState(pathname);
  if (navPath !== pathname) {
    setNavPath(pathname);
    setNavOpen(false);
  }
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [okrOpen, setOkrOpen] = useState(() => /\/okrs(\/|$)/.test(pathname));
  const isAdmin = user.systemRole === "ADMIN";
  const desktopVersion = useDesktopVersion();
  const canEditViews = (ROLE_RANK[role] ?? -1) >= ROLE_RANK.editor;
  const canCreateProject = canEditViews;

  const activeProjectId = pathname.match(/\/p\/([^/]+)/)?.[1];
  const activeViewId = searchParams.get("view");
  const projectSection = pathname.match(/\/p\/[^/]+\/(objectives|history|wiki|settings|t)(?:\/|$)/)?.[1] ?? null;
  const isMyWork = pathname.includes("/my-work");
  const isDashboards = pathname.endsWith("/dashboards") || pathname.includes("/dash/");
  const isSettings = pathname.includes("/settings");
  const isTeamOkrs = /\/okrs$/.test(pathname);
  const isMyOkrs = pathname.endsWith("/okrs/my");
  const isOkrDashboard = pathname.endsWith("/okrs/dashboard");
  const isOkrDetail = /\/okrs\/[^/]+$/.test(pathname) && !isMyOkrs && !isOkrDashboard && !isTeamOkrs;

  function toggleExpand(id: string) {
    setToggled((prev) => new Map(prev).set(id, !isProjectOpen(id)));
  }

  async function renameProject(project: ProjectLite) {
    const name = prompt(t("common.rename"), project.name);
    if (!name || name === project.name) return;
    try {
      await api.patch(`/api/projects/${project.id}`, { name });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function deleteProject(project: ProjectLite) {
    if (!confirm(t("project.deleteConfirm", { name: project.name }))) return;
    try {
      await api.delete(`/api/projects/${project.id}`);
      if (activeProjectId === project.id) router.push(`/w/${workspace.slug}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function createView(projectId: string, type: string) {
    const labelKey = NEW_VIEW_TYPES.find((v) => v.type === type)?.label;
    const label = labelKey ? t(labelKey) : "View";
    const name = prompt(t("view.namePrompt"), label) || label;
    try {
      const view = await api.post<{ id: string }>(`/api/projects/${projectId}/views`, { name, type });
      emitViewsChanged(projectId);
      router.push(`/w/${workspace.slug}/p/${projectId}?view=${view.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function renameView(projectId: string, view: ViewLite) {
    const name = prompt(t("common.rename"), view.name);
    if (!name || name === view.name) return;
    try {
      await api.patch(`/api/views/${view.id}`, { name });
      emitViewsChanged(projectId);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function duplicateView(projectId: string, view: ViewLite) {
    try {
      const source = await api.get<{ config: string }>(`/api/views/${view.id}`);
      const copy = await api.post<{ id: string }>(`/api/projects/${projectId}/views`, { name: `${view.name} copy`, type: view.type, config: JSON.parse(source.config || "{}") });
      emitViewsChanged(projectId);
      router.push(`/w/${workspace.slug}/p/${projectId}?view=${copy.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function deleteView(projectId: string, view: ViewLite) {
    if (!confirm(t("common.confirmDelete", { name: view.name }))) return;
    try {
      await api.delete(`/api/views/${view.id}`);
      emitViewsChanged(projectId);
      if (activeViewId === view.id) router.push(`/w/${workspace.slug}/p/${projectId}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function reorderViews(projectId: string, orderedIds: string[]) {
    try {
      await Promise.all(orderedIds.map((id, i) => api.patch(`/api/views/${id}`, { order: i })));
      emitViewsChanged(projectId);
      router.refresh();
    } catch {
      toast.error(t("common.failed"));
    }
  }

  const navItem = (active: boolean) =>
    cn(
      "flex items-center gap-2.5 rounded-lg px-2.5 py-[5px] text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40",
      active ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/70"
    );
  const isHome = pathname === `/w/${workspace.slug}`;
  const isInbox = pathname.endsWith("/inbox");
  const activeWikiId = pathname.match(/\/wiki\/([0-9a-f-]{36})/)?.[1];
  const isWikiHome = pathname.endsWith("/wiki");
  const isBrain = pathname.includes(`/w/${workspace.slug}/brain`);
  const isRecognition = pathname.includes(`/w/${workspace.slug}/recognition`);
  const isAi = pathname.includes("/ai");
  const isAgentWork = pathname.includes("/agent-work");
  const okrActive = isTeamOkrs || isMyOkrs || isOkrDashboard || isOkrDetail;
  const wikiOpenNow = wikiOpen ?? (isWikiHome || !!activeWikiId);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-neutral-50 dark:bg-neutral-950 text-sm">
      {/* Sidebar */}
      {navOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setNavOpen(false)} data-testid="nav-backdrop" />}
      <aside
        className={cn(
          "w-[17rem] shrink-0 border-r border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col",
          "fixed inset-y-0 left-0 z-50 transition-[transform,width] duration-200 lg:static lg:translate-x-0",
          compact ? "lg:w-[3.75rem]" : "lg:w-[15rem]",
          navOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"
        )}
        data-testid="sidebar"
        data-compact={compact ? "1" : undefined}
      >
        <div className={cn("h-14 flex items-center gap-2 shrink-0", compact ? "lg:px-2 px-3" : "px-3")}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2.5 flex-1 rounded-lg px-1.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 min-w-0" data-testid="workspace-switcher" title={workspace.name}>
                <WorkspaceAvatar name={workspace.name} logoUrl={workspace.logoUrl} size={28} />
                <span className={cn("font-semibold text-neutral-900 dark:text-neutral-50 truncate text-[14px]", compact && "lg:hidden")}>{workspace.name}</span>
                <ChevronDown size={14} className={cn("text-neutral-400 shrink-0 ml-auto", compact && "lg:hidden")} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60">
              <DropdownMenuLabel>{t("ws.switch")}</DropdownMenuLabel>
              {workspaces.map((w) => (
                <DropdownMenuItem key={w.id} onSelect={() => router.push(`/w/${w.slug}`)}>
                  <WorkspaceAvatar name={w.name} logoUrl={w.logoUrl} size={20} className="rounded-md" />
                  <span className={cn("truncate", w.slug === workspace.slug && "font-semibold")}>{w.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => router.push("/workspaces")}>
                <Building2 size={14} /> {t("ws.all")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <nav className={cn("flex-1 overflow-y-auto thin-scroll pb-2 space-y-px", compact ? "lg:px-2 px-3" : "px-3")}>
          <NavSection label={t("nav.group.work")} compact={compact} first />
          <NavLink href={`/w/${workspace.slug}`} active={isHome} icon={Home} label={t("nav.home")} compact={compact} testId="nav-home" />
          <NavLink href={`/w/${workspace.slug}/my-work`} active={isMyWork} icon={ListChecks} label={t("nav.myWork")} compact={compact} />
          <NavLink href={`/w/${workspace.slug}/inbox`} active={isInbox} icon={Inbox} label={t("nav.inbox")} compact={compact} testId="nav-inbox" badge={<UnreadCount />} />

          <NavSection label={t("nav.group.intelligence")} compact={compact} />
          <NavLink href={`/w/${workspace.slug}/ai`} active={isAi} icon={Sparkles} label={t("nav.ai")} compact={compact} testId="nav-ai" badge={<span className="text-[9px] font-semibold tracking-wide text-indigo-500/80">AI</span>} />
          <NavLink href={`/w/${workspace.slug}/agent-work`} active={isAgentWork} icon={Bot} label={t("nav.agentWork")} compact={compact} testId="nav-agent-work" />
          <NavLink href={`/w/${workspace.slug}/brain`} active={isBrain} icon={Brain} label={t("nav.brain")} compact={compact} testId="nav-brain" />
          <NavLink href={`/w/${workspace.slug}/dashboards`} active={isDashboards} icon={BarChart3} label={t("nav.reports")} compact={compact} />

          <NavSection label={t("nav.group.manage")} compact={compact} />
          {compact ? (
            <NavLink href={`/w/${workspace.slug}/okrs`} active={okrActive} icon={Target} label={t("nav.okrs")} compact={compact} />
          ) : (
            <>
              <button onClick={() => setOkrOpen((v) => !v)} className={cn(navItem(okrActive && !okrOpen), "w-full")} aria-expanded={okrOpen}>
                <Target size={16} strokeWidth={1.75} className={okrActive ? "text-indigo-600 dark:text-indigo-400" : ""} /> <span className="flex-1 text-left">{t("nav.okrs")}</span>
                {okrOpen ? <ChevronDown size={13} className="text-neutral-400" /> : <ChevronRight size={13} className="text-neutral-400" />}
              </button>
              {okrOpen && (
                <div className="ml-[17px] pl-2.5 border-l border-neutral-200 dark:border-neutral-800 space-y-px">
                  <Link href={`/w/${workspace.slug}/okrs`} className={cn(navItem(isTeamOkrs || isOkrDetail), "py-1")}>{t("nav.teamOkrs")}</Link>
                  <Link href={`/w/${workspace.slug}/okrs/my`} className={cn(navItem(isMyOkrs), "py-1")}>{t("nav.myOkrs")}</Link>
                  <Link href={`/w/${workspace.slug}/okrs/dashboard`} className={cn(navItem(isOkrDashboard), "py-1")}>{t("nav.okrDashboard")}</Link>
                </div>
              )}
            </>
          )}
          <NavLink href={`/w/${workspace.slug}/recognition`} active={isRecognition} icon={Award} label={t("nav.recognition")} compact={compact} testId="nav-recognition" badge={<RecognitionCount workspaceId={workspace.id} />} />

          <NavSection label={t("nav.group.knowledge")} compact={compact} />
          <div className="flex items-center">
            <NavLink href={`/w/${workspace.slug}/wiki`} active={isWikiHome} icon={BookOpen} label={t("nav.wiki")} compact={compact} testId="nav-wiki" className="flex-1" />
            {!compact && wikis.length > 0 && (
              <button onClick={() => setWikiOpen(!wikiOpenNow)} className="h-7 w-6 flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" aria-expanded={wikiOpenNow} aria-label={t("nav.wiki")} data-testid="sidebar-wiki-toggle">
                {wikiOpenNow ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
            )}
          </div>
          {!compact && wikiOpenNow && wikis.length > 0 && (
            <div className="ml-[17px] pl-2.5 border-l border-neutral-200 dark:border-neutral-800 space-y-px">
              {wikis.map((w) => (
                <Link key={w.id} href={`/w/${workspace.slug}/wiki/${w.id}`} className={cn(navItem(activeWikiId === w.id), "py-1")} data-testid="sidebar-wiki">
                  <span className="h-4 w-4 rounded flex items-center justify-center text-[10px] shrink-0 font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-950/70 dark:text-indigo-300">
                    {w.icon || w.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-1 truncate">{w.name}</span>
                  {w.access === "restricted" && <Lock size={10} className="text-neutral-400 shrink-0" />}
                </Link>
              ))}
            </div>
          )}

          <div className={cn("pt-4 pb-1 flex items-center justify-between text-[10.5px] font-semibold text-neutral-400 uppercase tracking-wider", compact ? "lg:justify-center lg:px-0 px-2.5" : "px-2.5")}>
            <span className={cn(compact && "lg:hidden")}>{t("nav.projects")}</span>
            {compact && <span className="hidden lg:block h-px w-6 bg-neutral-200 dark:bg-neutral-800" aria-hidden />}
            {canCreateProject && !compact && (
              <button onClick={() => setNewProjectOpen(true)} className="rounded p-0.5 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200" title={t("nav.newProject")} data-testid="sidebar-new-project">
                <Plus size={14} />
              </button>
            )}
          </div>

          {projects.length === 0 && !compact && (
            <div className="px-2.5 py-1 text-xs text-neutral-400">
              {canCreateProject ? (
                <button onClick={() => setNewProjectOpen(true)} className="hover:text-neutral-600">{t("nav.createFirstProject")}</button>
              ) : (
                t("nav.noProjects")
              )}
            </div>
          )}

          {compact &&
            projects.map((project) => (
              <Link key={project.id} href={`/w/${workspace.slug}/p/${project.id}`} title={project.name} aria-label={project.name} className={cn("hidden lg:flex h-8 w-full items-center justify-center rounded-lg", activeProjectId === project.id ? "bg-indigo-50 dark:bg-indigo-950/50" : "hover:bg-neutral-100 dark:hover:bg-neutral-800/70")}>
                <ProjectIcon icon={project.icon} size={15} />
              </Link>
            ))}
          {compact && canCreateProject && (
            <button onClick={() => setNewProjectOpen(true)} className="hidden lg:flex h-8 w-full items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t("nav.newProject")}>
              <Plus size={15} />
            </button>
          )}

          {projects.map((project) => {
            const open = isProjectOpen(project.id);
            return (
            <div key={project.id} className={cn(compact && "lg:hidden")}>
              <div
                className={cn(
                  "group flex items-center gap-1 rounded-lg px-1.5 py-1 cursor-pointer",
                  activeProjectId === project.id ? "bg-indigo-50/70 dark:bg-indigo-950/40" : "hover:bg-neutral-100 dark:hover:bg-neutral-800/70"
                )}
              >
                <button onClick={() => toggleExpand(project.id)} className="text-neutral-400 shrink-0" aria-expanded={open}>
                  {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <Link href={`/w/${workspace.slug}/p/${project.id}`} className="flex items-center gap-2 flex-1 min-w-0">
                  <ProjectIcon icon={project.icon} size={14} />
                  <span className={cn("truncate text-[13px]", activeProjectId === project.id ? "text-indigo-700 dark:text-indigo-300 font-semibold" : "text-neutral-700 dark:text-neutral-300 font-medium")}>{project.name}</span>
                </Link>
                {(
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0" title={t("nav.addView")}>
                        <Plus size={13} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuLabel>{t("nav.newView")}</DropdownMenuLabel>
                      {NEW_VIEW_TYPES.map((vt) => (
                        <DropdownMenuItem key={vt.type} onSelect={() => createView(project.id, vt.type)}>
                          {t(vt.label)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {canEditViews && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0" title={t("nav.projectOptions")}>
                        <MoreHorizontal size={13} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => renameProject(project)}>
                        <Pencil size={13} /> {t("common.rename")}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => router.push(`/w/${workspace.slug}/p/${project.id}/settings`)}>
                        <SlidersHorizontal size={13} /> {t("nav.projectSettings")}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => deleteProject(project)} className="text-red-600 dark:text-red-400">
                        <Trash2 size={13} /> {t("common.delete")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {open && (
                <div className="ml-[13px] border-l border-neutral-200 dark:border-neutral-800 pl-2 mb-1.5">
                  <div className="flex items-center justify-between pl-2.5 pr-1 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-400" data-testid={`sidebar-views-${project.id}`}>
                    <span>{t("nav.views")}</span>
                  </div>
                  <div className="space-y-0.5">
                    <ViewList
                      project={project}
                      workspaceSlug={workspace.slug}
                      activeProjectId={projectSection && projectSection !== "t" ? undefined : activeProjectId}
                      activeViewId={activeViewId}
                      canEdit={canEditViews}
                      onRename={(v) => renameView(project.id, v)}
                      onDuplicate={(v) => duplicateView(project.id, v)}
                      onDelete={(v) => deleteView(project.id, v)}
                      onReorder={(ids) => reorderViews(project.id, ids)}
                    />
                  </div>
                  <div className="mt-1.5 pt-1.5 border-t border-dashed border-neutral-200 dark:border-neutral-800 space-y-0.5">
                    {(
                      [
                        ["objectives", t("nav.objectives"), TargetIcon],
                        ["history", t("vh.title"), Clock3],
                        ["settings", t("nav.projectSettings"), SlidersHorizontal],
                      ] as const
                    ).map(([section, label, Icon]) => (
                      <Link
                        key={section}
                        href={`/w/${workspace.slug}/p/${project.id}/${section}`}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-2.5 py-1 truncate text-[12px] font-medium",
                          activeProjectId === project.id && projectSection === section
                            ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300"
                            : "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        )}
                        data-testid={`sidebar-${section}-${project.id}`}
                      >
                        <Icon size={13} />
                        <span className="truncate">{label}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </nav>

        {/* Sticky footer: a quiet desktop-app link, settings and the compact toggle. */}
        <div className={cn("shrink-0 border-t border-neutral-200/80 dark:border-neutral-800 py-2 space-y-px", compact ? "lg:px-2 px-3" : "px-3")}>
          {!desktopVersion && !promoHidden && !compact && (
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px] text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-800/60" data-testid="sidebar-download-desktop">
              <MonitorDown size={15} strokeWidth={1.75} className="shrink-0" />
              <Link href="/download" className="flex-1 truncate hover:text-indigo-600" title={t("nav.desktopCardSub")}>
                {t("nav.download")}
              </Link>
              <button onClick={hidePromo} className="text-neutral-300 hover:text-neutral-600 dark:hover:text-neutral-300" aria-label={t("common.close")} data-testid="sidebar-download-hide">
                <X size={12} />
              </button>
            </div>
          )}
          <NavLink href={`/w/${workspace.slug}/settings`} active={isSettings && !projectSection} icon={Settings} label={t("nav.settings")} compact={compact} testId="nav-settings" />
          <button onClick={toggleCompact} className={cn("hidden lg:flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200", compact && "justify-center px-0")} title={compact ? t("nav.expand") : t("nav.collapse")} data-testid="sidebar-compact">
            {compact ? <PanelLeftOpen size={16} strokeWidth={1.75} /> : <PanelLeftClose size={16} strokeWidth={1.75} />}
            {!compact && <span>{t("nav.collapse")}</span>}
          </button>
        </div>
      </aside>

      {/* Main column: global top bar, then each page renders its own header */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-14 shrink-0 flex items-center gap-2 sm:gap-3 px-2 sm:px-5 border-b border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900">
          <button onClick={() => setNavOpen(true)} className="lg:hidden rounded-md p-2 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t("nav.menu")} data-testid="nav-open">
            <Menu size={18} />
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 min-w-0 flex-1 sm:flex-none sm:w-full max-w-md h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50 px-3 text-neutral-400 hover:border-neutral-300"
            data-testid="topbar-search"
          >
            <Search size={15} className="shrink-0" />
            <span className="flex-1 text-left text-[13px] truncate">{t("nav.searchPlaceholder")}</span>
            <kbd className="hidden sm:inline text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-400">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-0.5 sm:gap-1.5 shrink-0">
            <NotificationBell align="end" />
            <Link href={`/w/${workspace.slug}/ai`} className="hidden sm:block rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t("nav.ai")}>
              <Sparkles size={16} />
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg pl-1 pr-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 ml-1" data-testid="user-menu">
                  {user.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- authorized avatar route
                    <img src={user.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover shrink-0" data-testid="user-avatar" />
                  ) : (
                    <span className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0" style={{ backgroundColor: user.avatarColor }}>
                      {initials(user.name)}
                    </span>
                  )}
                  <span className="hidden md:block text-left leading-tight">
                    <span className="block text-[13px] font-semibold text-neutral-800 dark:text-neutral-100 max-w-40 truncate">{user.name}</span>
                    <span className="block text-[11px] text-neutral-400">{t(`role.${role}` as MessageKey)}</span>
                  </span>
                  <ChevronDown size={13} className="text-neutral-400 hidden sm:block" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end">
                <DropdownMenuLabel>
                  {user.email}
                  {desktopVersion && <div className="text-[10px] font-normal text-neutral-400">{t("nav.desktopVersion", { version: desktopVersion })}</div>}
                </DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => router.push(`/w/${workspace.slug}/settings?section=profile`)} data-testid="menu-profile">
                  <UserCircle size={14} /> {t("nav.profile")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPrefsOpen(true)}>
                  <Palette size={14} /> {t("nav.preferences")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => router.push("/account/password")}>
                  <KeyRound size={14} /> {t("nav.changePassword")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => router.push("/workspaces")}>
                  <Building2 size={14} /> {t("ws.all")}
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem onSelect={() => router.push("/admin")}>
                    <ShieldCheck size={14} /> {t("nav.adminConsole")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={toggle}>
                  {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                  {theme === "dark" ? t("nav.lightMode") : t("nav.darkMode")}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/" })}>
                  <LogOut size={14} /> {t("auth.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">{children}</div>
      </div>

      <FocusDock workspaceId={workspace.id} />
      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} workspaceId={workspace.id} workspaceSlug={workspace.slug} />
      <PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} workspaceId={workspace.id} workspaceSlug={workspace.slug} />
      <AgentSuggestionPopup workspaceId={workspace.id} workspaceSlug={workspace.slug} />
    </div>
  );
}

function ViewList({
  project,
  workspaceSlug,
  activeProjectId,
  activeViewId,
  canEdit,
  onRename,
  onDuplicate,
  onDelete,
  onReorder,
}: {
  project: ProjectLite;
  workspaceSlug: string;
  activeProjectId: string | undefined;
  activeViewId: string | null;
  canEdit: boolean;
  onRename: (view: ViewLite) => void;
  onDuplicate: (view: ViewLite) => void;
  onDelete: (view: ViewLite) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = project.views.map((v) => v.id);
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  }

  const isDefaultViewActive = activeProjectId === project.id && !activeViewId;

  return (
    <DndContext id="sidebar-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={project.views.map((v) => v.id)} strategy={verticalListSortingStrategy}>
        {project.views.map((view, i) => (
          <ViewRow
            key={view.id}
            href={`/w/${workspaceSlug}/p/${project.id}?view=${view.id}`}
            view={view}
            canEdit={canEdit}
            active={activeProjectId === project.id && (activeViewId === view.id || (isDefaultViewActive && i === 0))}
            onRename={() => onRename(view)}
            onDuplicate={() => onDuplicate(view)}
            onDelete={() => onDelete(view)}
          />
        ))}
      </SortableContext>
    </DndContext>
  );
}

function ViewRow({
  href,
  view,
  active,
  canEdit,
  onRename,
  onDuplicate,
  onDelete,
}: {
  href: string;
  view: ViewLite;
  active: boolean;
  canEdit: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: view.id, disabled: !canEdit });
  const Icon = VIEW_ICONS[view.type] ?? Sheet;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("group/view flex items-center rounded-md", isDragging && "opacity-50 relative z-10")}>
      {canEdit ? <span {...attributes} {...listeners} className="text-neutral-300 dark:text-neutral-700 cursor-grab opacity-0 group-hover/view:opacity-100 shrink-0 w-3 -ml-0.5"><GripVertical size={12} /></span> : <span className="shrink-0 w-2" />}
      <Link
        href={href}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-1.5 py-1 truncate flex-1 min-w-0",
          active ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        )}
      >
        <Icon size={13} />
        <span className="truncate">{view.name}</span>
      </Link>
      {(canEdit || view.canDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="opacity-0 group-hover/view:opacity-100 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0 px-0.5">
              <MoreHorizontal size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {canEdit && <DropdownMenuItem onSelect={onRename}>
              <Pencil size={13} /> {t("common.rename")}
            </DropdownMenuItem>}
            {canEdit && <DropdownMenuItem onSelect={onDuplicate}>
              <Copy size={13} /> {t("common.duplicate")}
            </DropdownMenuItem>}
            {canEdit && view.canDelete && <DropdownMenuSeparator />}
            {view.canDelete && <DropdownMenuItem onSelect={onDelete} className="text-red-600 dark:text-red-400">
              <Trash2 size={13} /> {t("common.delete")}
            </DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function readPref(key: string) {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}

/** Group label; in compact mode a thin divider instead. */
function NavSection({ label, compact, first }: { label: string; compact: boolean; first?: boolean }) {
  return (
    <div className={cn(first ? "pt-1" : "pt-3.5", "pb-1")}>
      <span className={cn("block px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400", compact && "lg:hidden")}>{label}</span>
      {compact && !first && <span className="hidden lg:block mx-auto h-px w-6 bg-neutral-200 dark:bg-neutral-800" aria-hidden />}
    </div>
  );
}

/** One sidebar entry: same icon size and stroke everywhere; icon-only with a tooltip when compact. */
function NavLink({ href, active, icon: Icon, label, compact, badge, testId, className }: { href: string; active: boolean; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; label: string; compact: boolean; badge?: React.ReactNode; testId?: string; className?: string }) {
  return (
    <Link
      href={href}
      title={compact ? label : undefined}
      aria-label={compact ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex items-center gap-2.5 rounded-lg px-2.5 py-[5px] text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/40",
        compact && "lg:justify-center lg:px-0 lg:h-8",
        active ? "bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/70",
        className
      )}
      data-testid={testId}
    >
      <Icon size={16} strokeWidth={1.75} className={cn("shrink-0", active ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-500 dark:text-neutral-400")} />
      <span className={cn("flex-1 truncate", compact && "lg:hidden")}>{label}</span>
      {badge && <span className={cn(compact && "lg:absolute lg:-top-0.5 lg:-right-0.5 lg:scale-75 lg:origin-top-right")}>{badge}</span>}
    </Link>
  );
}
