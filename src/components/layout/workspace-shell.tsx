"use client";
import { useState } from "react";
import Link from "next/link";
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
  FolderKanban,
  ShieldCheck,
  KeyRound,
  MonitorDown,
  LayoutGrid,
  LayoutDashboard,
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
  Briefcase,
  MoreHorizontal,
  Pencil,
  Copy,
  Trash2,
  GripVertical,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
};
const NEW_VIEW_TYPES = [
  { type: "grid", label: "Table" },
  { type: "kanban", label: "Kanban" },
  { type: "calendar", label: "Calendar" },
  { type: "gantt", label: "Gantt" },
  { type: "eisenhower", label: "Eisenhower" },
  { type: "gallery", label: "Gallery" },
  { type: "form", label: "Form" },
];

interface ViewLite { id: string; name: string; type: string }
interface ProjectLite { id: string; name: string; color: string; views: ViewLite[] }
interface WorkspaceLite { id: string; name: string; slug: string }

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
  const [expanded, setExpanded] = useState<Set<string>>(new Set(projects.map((p) => p.id)));
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const isAdmin = user.systemRole === "ADMIN";
  const desktopVersion = useDesktopVersion();
  const canManage = (ROLE_RANK[role] ?? -1) >= ROLE_RANK.admin;
  const canEditViews = (ROLE_RANK[role] ?? -1) >= ROLE_RANK.editor;

  const activeProjectId = pathname.match(/\/p\/([^/]+)/)?.[1];
  const activeViewId = searchParams.get("view");
  const isMyWork = pathname.includes("/my-work");
  const isDashboards = pathname.endsWith("/dashboards") || pathname.includes("/dash/");
  const isSettings = pathname.includes("/settings");
  const isTeamOkrs = /\/okrs$/.test(pathname);
  const isMyOkrs = pathname.endsWith("/okrs/my");
  const isOkrDashboard = pathname.endsWith("/okrs/dashboard");
  const isOkrDetail = /\/okrs\/[^/]+$/.test(pathname) && !isMyOkrs && !isOkrDashboard && !isTeamOkrs;

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function createProject() {
    const name = newProjectName.trim();
    if (!name) return;
    try {
      const project = await api.post<{ id: string }>(`/api/workspaces/${workspace.id}/projects`, { name });
      setNewProjectOpen(false);
      setNewProjectName("");
      router.push(`/w/${workspace.slug}/p/${project.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create project");
    }
  }

  async function renameProject(project: ProjectLite) {
    const name = prompt("Rename project", project.name);
    if (!name || name === project.name) return;
    try {
      await api.patch(`/api/projects/${project.id}`, { name });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename project");
    }
  }

  async function deleteProject(project: ProjectLite) {
    if (!confirm(`Delete project "${project.name}" and hide all its tasks? The data stays in the database (soft delete).`)) return;
    try {
      await api.delete(`/api/projects/${project.id}`);
      if (activeProjectId === project.id) router.push(`/w/${workspace.slug}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete project");
    }
  }

  async function createView(projectId: string, type: string) {
    const label = NEW_VIEW_TYPES.find((v) => v.type === type)?.label ?? "View";
    const name = prompt(`Name for this ${label} view`, label) || label;
    try {
      const view = await api.post<{ id: string }>(`/api/projects/${projectId}/views`, { name, type });
      router.push(`/w/${workspace.slug}/p/${projectId}?view=${view.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create view");
    }
  }

  async function renameView(view: ViewLite) {
    const name = prompt("Rename view", view.name);
    if (!name || name === view.name) return;
    try {
      await api.patch(`/api/views/${view.id}`, { name });
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to rename view");
    }
  }

  async function duplicateView(projectId: string, view: ViewLite) {
    try {
      const source = await api.get<{ config: string }>(`/api/views/${view.id}`);
      const copy = await api.post<{ id: string }>(`/api/projects/${projectId}/views`, { name: `${view.name} copy`, type: view.type, config: JSON.parse(source.config || "{}") });
      router.push(`/w/${workspace.slug}/p/${projectId}?view=${copy.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to duplicate view");
    }
  }

  async function deleteView(view: ViewLite) {
    if (!confirm(`Delete view "${view.name}"?`)) return;
    try {
      await api.delete(`/api/views/${view.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete view");
    }
  }

  async function reorderViews(orderedIds: string[]) {
    try {
      await Promise.all(orderedIds.map((id, i) => api.patch(`/api/views/${id}`, { order: i })));
      router.refresh();
    } catch {
      toast.error("Failed to reorder views");
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-neutral-50 dark:bg-neutral-950 text-sm">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col">
        <div className="h-12 flex items-center gap-2 px-3 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 flex-1 rounded-md px-1.5 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 min-w-0">
                <div className="h-6 w-6 rounded-md bg-indigo-600 flex items-center justify-center text-white shrink-0">
                  <LayoutGrid size={14} />
                </div>
                <span className="font-semibold text-neutral-900 dark:text-neutral-50 truncate">{workspace.name}</span>
                <ChevronDown size={13} className="text-neutral-400 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {workspaces.map((w) => (
                <DropdownMenuItem key={w.id} onSelect={() => router.push(`/w/${w.slug}`)}>
                  <span className={cn("truncate", w.slug === workspace.slug && "font-semibold")}>{w.name}</span>
                </DropdownMenuItem>
              ))}
              {isAdmin && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => router.push("/admin")}>
                    <ShieldCheck size={14} /> Admin console
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <nav className="flex-1 overflow-y-auto thin-scroll py-2 px-2 space-y-0.5">
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 mb-2"
          >
            <Search size={14} />
            <span className="flex-1 text-left">Search</span>
            <kbd className="text-[10px] px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-400">Ctrl K</kbd>
          </button>

          <Link
            href={`/w/${workspace.slug}/my-work`}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 mb-2",
              isMyWork ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            )}
          >
            <Briefcase size={14} />
            <span className="flex-1 text-left">My Work</span>
          </Link>

          <div className="mb-2">
            <div className="px-2 mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-neutral-400 uppercase tracking-wide">
              <Target size={12} /> OKRs
            </div>
            <Link
              href={`/w/${workspace.slug}/okrs`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 ml-1",
                isTeamOkrs || isOkrDetail ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              )}
            >
              <span className="flex-1 text-left text-sm">Team OKRs</span>
            </Link>
            <Link
              href={`/w/${workspace.slug}/okrs/my`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 ml-1",
                isMyOkrs ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              )}
            >
              <span className="flex-1 text-left text-sm">My OKRs</span>
            </Link>
            <Link
              href={`/w/${workspace.slug}/okrs/dashboard`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 ml-1",
                isOkrDashboard ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              )}
            >
              <span className="flex-1 text-left text-sm">Dashboard</span>
            </Link>
          </div>

          <Link
            href={`/w/${workspace.slug}/dashboards`}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 mb-2",
              isDashboards ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            )}
          >
            <LayoutDashboard size={14} />
            <span className="flex-1 text-left">Dashboard</span>
          </Link>

          <div className="mt-1 mb-1 px-2 flex items-center justify-between text-xs font-semibold text-neutral-400 uppercase tracking-wide">
            <span>Projects</span>
            {canManage && (
              <button onClick={() => setNewProjectOpen(true)} className="hover:text-neutral-700 dark:hover:text-neutral-200" title="New project">
                <Plus size={13} />
              </button>
            )}
          </div>

          {projects.length === 0 && (
            <div className="px-2 py-1 text-xs text-neutral-400">
              {canManage ? (
                <button onClick={() => setNewProjectOpen(true)} className="hover:text-neutral-600">+ Create the first project</button>
              ) : (
                "No projects yet"
              )}
            </div>
          )}

          {projects.map((project) => (
            <div key={project.id}>
              <div
                className={cn(
                  "group flex items-center gap-1 rounded-md px-1.5 py-1.5 cursor-pointer",
                  activeProjectId === project.id ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                )}
              >
                <button onClick={() => toggleExpand(project.id)} className="text-neutral-400 shrink-0">
                  {expanded.has(project.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <Link href={`/w/${workspace.slug}/p/${project.id}`} className="flex items-center gap-1.5 flex-1 min-w-0">
                  <FolderKanban size={14} style={{ color: project.color }} className="shrink-0" />
                  <span className="truncate text-neutral-800 dark:text-neutral-200 font-medium">{project.name}</span>
                </Link>
                {canEditViews && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0" title="Add view">
                        <Plus size={13} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuLabel>New view</DropdownMenuLabel>
                      {NEW_VIEW_TYPES.map((vt) => (
                        <DropdownMenuItem key={vt.type} onSelect={() => createView(project.id, vt.type)}>
                          {vt.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                {canManage && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0" title="Project options">
                        <MoreHorizontal size={13} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => renameProject(project)}>
                        <Pencil size={13} /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => deleteProject(project)} className="text-red-600 dark:text-red-400">
                        <Trash2 size={13} /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              {expanded.has(project.id) && (
                <div className="ml-5 border-l border-neutral-200 dark:border-neutral-800 pl-2 space-y-0.5 mb-1">
                  <ViewList
                    project={project}
                    workspaceSlug={workspace.slug}
                    activeProjectId={activeProjectId}
                    activeViewId={activeViewId}
                    canEdit={canEditViews}
                    onRename={renameView}
                    onDuplicate={(v) => duplicateView(project.id, v)}
                    onDelete={deleteView}
                    onReorder={reorderViews}
                  />
                </div>
              )}
            </div>
          ))}

          <div className="mt-3 pt-2 border-t border-neutral-200 dark:border-neutral-800 space-y-0.5">
            {!desktopVersion && (
              <Link href="/download" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800" data-testid="sidebar-download-desktop">
                <MonitorDown size={14} />
                <span className="flex-1 text-left">Download desktop app</span>
              </Link>
            )}
            <Link
              href={`/w/${workspace.slug}/settings`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5",
                isSettings ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              )}
            >
              <Settings size={14} />
              <span className="flex-1 text-left">Settings</span>
            </Link>
          </div>
        </nav>

        <div className="border-t border-neutral-200 dark:border-neutral-800 p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <div className="h-6 w-6 rounded-full flex items-center justify-center text-white text-[11px] font-medium shrink-0" style={{ backgroundColor: user.avatarColor }}>
                  {initials(user.name)}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="truncate text-neutral-800 dark:text-neutral-200 font-medium">{user.name}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-52">
              <DropdownMenuLabel>
                {user.email}
                {desktopVersion && <div className="text-[10px] font-normal text-neutral-400">Desktop app v{desktopVersion}</div>}
              </DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => router.push("/account/password")}>
                <KeyRound size={14} /> Change password
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem onSelect={() => router.push("/admin")}>
                  <ShieldCheck size={14} /> Admin console
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={toggle}>
                {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/login" })}>
                <LogOut size={14} /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main content column, top bar rendered per-page (breadcrumb depends on table) */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">{children}</div>

      <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <DialogContent>
          <DialogTitle>New project</DialogTitle>
          <Input autoFocus value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="e.g. Q4 Onboarding" onKeyDown={(e) => e.key === "Enter" && createProject()} />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setNewProjectOpen(false)}>Cancel</Button>
            <Button onClick={createProject} disabled={!newProjectName.trim()}>Create project</Button>
          </div>
        </DialogContent>
      </Dialog>

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
              <Pencil size={13} /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate}>
              <Copy size={13} /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} className="text-red-600 dark:text-red-400">
              <Trash2 size={13} /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
