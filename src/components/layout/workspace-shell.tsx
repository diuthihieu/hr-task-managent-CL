"use client";
import { useState } from "react";
import Link from "next/link";
import { NotificationBell, UnreadCount } from "@/components/notifications/notification-bell";
import { WorkspaceAvatar } from "@/components/workspaces/workspace-avatar";
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
  GanttChartSquare,
  GalleryHorizontal,
  FileInput,
  Grid2x2,
  Search,
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
  SlidersHorizontal,
  Palette,
  Building2,
  Home,
  ListChecks,
  Inbox,
  Sparkles,
} from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { PreferencesDialog } from "@/components/preferences/preferences-dialog";
import { NewProjectDialog } from "@/components/projects/new-project-dialog";
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

interface ViewLite { id: string; name: string; type: string }
interface ProjectLite { id: string; name: string; color: string; views: ViewLite[] }
interface WorkspaceLite { id: string; name: string; slug: string; logoUrl?: string | null }

const ROLE_RANK: Record<string, number> = { viewer: 0, contributor: 1, editor: 2, admin: 3, owner: 4 };

export function WorkspaceShell({
  workspace,
  workspaces,
  projects,
  user,
  role,
  children,
}: {
  workspace: WorkspaceLite;
  workspaces: WorkspaceLite[];
  projects: ProjectLite[];
  user: { id: string; name: string; email: string; systemRole: "ADMIN" | "MEMBER"; avatarColor: string };
  role: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { t } = useT();
  // Projects are expanded unless the user collapsed them (new projects show their sections right away).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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
  const projectSection = pathname.match(/\/p\/[^/]+\/(objectives|wiki|settings|t)(?:\/|$)/)?.[1] ?? null;
  const isMyWork = pathname.includes("/my-work");
  const isDashboards = pathname.endsWith("/dashboards") || pathname.includes("/dash/");
  const isSettings = pathname.includes("/settings");
  const isTeamOkrs = /\/okrs$/.test(pathname);
  const isMyOkrs = pathname.endsWith("/okrs/my");
  const isOkrDashboard = pathname.endsWith("/okrs/dashboard");
  const isOkrDetail = /\/okrs\/[^/]+$/.test(pathname) && !isMyOkrs && !isOkrDashboard && !isTeamOkrs;

  function toggleExpand(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
      router.push(`/w/${workspace.slug}/p/${projectId}?view=${view.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function renameView(view: ViewLite) {
    const name = prompt(t("common.rename"), view.name);
    if (!name || name === view.name) return;
    try {
      await api.patch(`/api/views/${view.id}`, { name });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function duplicateView(projectId: string, view: ViewLite) {
    try {
      const source = await api.get<{ config: string }>(`/api/views/${view.id}`);
      const copy = await api.post<{ id: string }>(`/api/projects/${projectId}/views`, { name: `${view.name} copy`, type: view.type, config: JSON.parse(source.config || "{}") });
      router.push(`/w/${workspace.slug}/p/${projectId}?view=${copy.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function deleteView(view: ViewLite) {
    if (!confirm(t("common.confirmDelete", { name: view.name }))) return;
    try {
      await api.delete(`/api/views/${view.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function reorderViews(orderedIds: string[]) {
    try {
      await Promise.all(orderedIds.map((id, i) => api.patch(`/api/views/${id}`, { order: i })));
      router.refresh();
    } catch {
      toast.error(t("common.failed"));
    }
  }

  const navItem = (active: boolean) =>
    cn(
      "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors",
      active ? "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-semibold" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800/70"
    );
  const isHome = pathname === `/w/${workspace.slug}`;
  const isInbox = pathname.endsWith("/inbox");
  const isAi = pathname.includes("/ai");
  const okrActive = isTeamOkrs || isMyOkrs || isOkrDashboard || isOkrDetail;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-neutral-50 dark:bg-neutral-950 text-sm">
      {/* Sidebar */}
      <aside className="w-[248px] shrink-0 border-r border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col">
        <div className="h-14 flex items-center gap-2 px-3 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2.5 flex-1 rounded-lg px-1.5 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 min-w-0" data-testid="workspace-switcher">
                <WorkspaceAvatar name={workspace.name} logoUrl={workspace.logoUrl} size={30} />
                <span className="font-semibold text-neutral-900 dark:text-neutral-50 truncate text-[15px]">{workspace.name}</span>
                <ChevronDown size={14} className="text-neutral-400 shrink-0 ml-auto" />
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

        <nav className="flex-1 overflow-y-auto thin-scroll pb-2 px-3 space-y-0.5">
          <Link href={`/w/${workspace.slug}`} className={navItem(isHome)} data-testid="nav-home">
            <Home size={16} /> <span className="flex-1">{t("nav.home")}</span>
          </Link>
          <Link href={`/w/${workspace.slug}/my-work`} className={navItem(isMyWork)}>
            <ListChecks size={16} /> <span className="flex-1">{t("nav.myWork")}</span>
          </Link>
          <Link href={`/w/${workspace.slug}/inbox`} className={navItem(isInbox)} data-testid="nav-inbox">
            <Inbox size={16} /> <span className="flex-1">{t("nav.inbox")}</span>
            <UnreadCount />
          </Link>
          <Link href={`/w/${workspace.slug}/ai`} className={navItem(isAi)} data-testid="nav-ai">
            <Sparkles size={16} /> <span className="flex-1">{t("nav.ai")}</span>
            <span className="text-[9px] font-bold uppercase tracking-wide rounded px-1 py-0.5 bg-indigo-600 text-white">AI</span>
          </Link>
          <button onClick={() => setOkrOpen((v) => !v)} className={cn(navItem(okrActive && !okrOpen), "w-full")}>
            <Target size={16} /> <span className="flex-1 text-left">{t("nav.okrs")}</span>
            {okrOpen ? <ChevronDown size={13} className="text-neutral-400" /> : <ChevronRight size={13} className="text-neutral-400" />}
          </button>
          {okrOpen && (
            <div className="ml-[18px] pl-3 border-l border-neutral-200 dark:border-neutral-800 space-y-0.5">
              <Link href={`/w/${workspace.slug}/okrs`} className={navItem(isTeamOkrs || isOkrDetail)}>{t("nav.teamOkrs")}</Link>
              <Link href={`/w/${workspace.slug}/okrs/my`} className={navItem(isMyOkrs)}>{t("nav.myOkrs")}</Link>
              <Link href={`/w/${workspace.slug}/okrs/dashboard`} className={navItem(isOkrDashboard)}>{t("nav.okrDashboard")}</Link>
            </div>
          )}
          <Link href={`/w/${workspace.slug}/dashboards`} className={navItem(isDashboards)}>
            <BarChart3 size={16} /> <span className="flex-1">{t("nav.reports")}</span>
          </Link>

          <div className="pt-4 pb-1 px-2.5 flex items-center justify-between text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
            <span>{t("nav.projects")}</span>
            {canCreateProject && (
              <button onClick={() => setNewProjectOpen(true)} className="rounded p-0.5 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200" title={t("nav.newProject")} data-testid="sidebar-new-project">
                <Plus size={14} />
              </button>
            )}
          </div>

          {projects.length === 0 && (
            <div className="px-2.5 py-1 text-xs text-neutral-400">
              {canCreateProject ? (
                <button onClick={() => setNewProjectOpen(true)} className="hover:text-neutral-600">{t("nav.createFirstProject")}</button>
              ) : (
                t("nav.noProjects")
              )}
            </div>
          )}

          {projects.map((project) => (
            <div key={project.id}>
              <div
                className={cn(
                  "group flex items-center gap-1 rounded-lg px-1.5 py-1.5 cursor-pointer",
                  activeProjectId === project.id ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800/70"
                )}
              >
                <button onClick={() => toggleExpand(project.id)} className="text-neutral-400 shrink-0">
                  {!collapsed.has(project.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <Link href={`/w/${workspace.slug}/p/${project.id}`} className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="h-2.5 w-2.5 rounded-[3px] shrink-0" style={{ backgroundColor: project.color }} />
                  <span className="truncate text-neutral-800 dark:text-neutral-200 font-medium text-[13px]">{project.name}</span>
                </Link>
                {canEditViews && (
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
              {!collapsed.has(project.id) && (
                <div className="ml-[13px] border-l border-neutral-200 dark:border-neutral-800 pl-2 space-y-0.5 mb-1">
                  <ViewList
                    project={project}
                    workspaceSlug={workspace.slug}
                    activeProjectId={projectSection && projectSection !== "t" ? undefined : activeProjectId}
                    activeViewId={activeViewId}
                    canEdit={canEditViews}
                    onRename={renameView}
                    onDuplicate={(v) => duplicateView(project.id, v)}
                    onDelete={deleteView}
                    onReorder={reorderViews}
                  />
                  {(
                    [
                      ["objectives", t("nav.objectives"), TargetIcon],
                      ["wiki", t("nav.wiki"), BookOpen],
                      ["settings", t("nav.projectSettings"), SlidersHorizontal],
                    ] as const
                  ).map(([section, label, Icon]) => (
                    <Link
                      key={section}
                      href={`/w/${workspace.slug}/p/${project.id}/${section}`}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-1.5 py-1 ml-2.5 truncate text-[13px]",
                        activeProjectId === project.id && projectSection === section
                          ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium"
                          : "text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      )}
                      data-testid={`sidebar-${section}-${project.id}`}
                    >
                      <Icon size={13} />
                      <span className="truncate">{label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="px-3 pb-3 space-y-1.5 shrink-0">
          {!desktopVersion && (
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/40 p-3" data-testid="sidebar-download-desktop">
              <div className="flex items-center gap-2">
                <MonitorDown size={16} className="text-indigo-600" />
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-neutral-800 dark:text-neutral-100">{t("nav.desktopCard")}</div>
                  <div className="text-[11px] text-neutral-500 truncate">{t("nav.desktopCardSub")}</div>
                </div>
              </div>
              <Link href="/download" className="mt-2 block text-center text-xs font-semibold rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 py-1.5 hover:bg-indigo-100">
                {t("nav.download")}
              </Link>
            </div>
          )}
          <Link href={`/w/${workspace.slug}/settings`} className={navItem(isSettings && !projectSection)}>
            <Settings size={16} /> <span className="flex-1">{t("nav.settings")}</span>
          </Link>
        </div>
      </aside>

      {/* Main column: global top bar, then each page renders its own header */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-14 shrink-0 flex items-center gap-3 px-5 border-b border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 w-full max-w-md h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800/50 px-3 text-neutral-400 hover:border-neutral-300"
            data-testid="topbar-search"
          >
            <Search size={15} />
            <span className="flex-1 text-left text-[13px]">{t("nav.searchPlaceholder")}</span>
            <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-400">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <NotificationBell align="end" />
            <Link href={`/w/${workspace.slug}/ai`} className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t("nav.ai")}>
              <Sparkles size={16} />
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg pl-1 pr-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 ml-1" data-testid="user-menu">
                  <span className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0" style={{ backgroundColor: user.avatarColor }}>
                    {initials(user.name)}
                  </span>
                  <span className="hidden md:block text-left leading-tight">
                    <span className="block text-[13px] font-semibold text-neutral-800 dark:text-neutral-100 max-w-40 truncate">{user.name}</span>
                    <span className="block text-[11px] text-neutral-400">{t(`role.${role}` as MessageKey)}</span>
                  </span>
                  <ChevronDown size={13} className="text-neutral-400" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end">
                <DropdownMenuLabel>
                  {user.email}
                  {desktopVersion && <div className="text-[10px] font-normal text-neutral-400">{t("nav.desktopVersion", { version: desktopVersion })}</div>}
                </DropdownMenuLabel>
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

      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} workspaceId={workspace.id} workspaceSlug={workspace.slug} />
      <PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} workspaceId={workspace.id} workspaceSlug={workspace.slug} />
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
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
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
      <span {...attributes} {...listeners} className="text-neutral-300 dark:text-neutral-700 cursor-grab opacity-0 group-hover/view:opacity-100 shrink-0 w-3 -ml-0.5">
        <GripVertical size={12} />
      </span>
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
      {canEdit && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="opacity-0 group-hover/view:opacity-100 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0 px-0.5">
              <MoreHorizontal size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onSelect={onRename}>
              <Pencil size={13} /> {t("common.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy size={13} /> {t("common.duplicate")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} className="text-red-600 dark:text-red-400">
              <Trash2 size={13} /> {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
