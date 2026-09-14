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
  Database,
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
  Archive,
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
interface TableLite { id: string; name: string; icon: string; views: ViewLite[] }
interface DashboardLite { id: string; name: string }
interface BaseLite { id: string; name: string; icon: string; color: string; tables: TableLite[]; dashboards: DashboardLite[] }
interface WorkspaceLite { id: string; name: string; slug: string }

export function WorkspaceShell({
  workspace,
  workspaces,
  bases,
  user,
  children,
}: {
  workspace: WorkspaceLite;
  workspaces: WorkspaceLite[];
  bases: BaseLite[];
  user: { id: string; name: string; email: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [expanded, setExpanded] = useState<Set<string>>(new Set(bases.map((b) => b.id)));
  const [newBaseOpen, setNewBaseOpen] = useState(false);
  const [newBaseName, setNewBaseName] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const activeBaseId = pathname.match(/\/b\/([^/]+)/)?.[1];
  const activeTableId = pathname.match(/\/t\/([^/]+)/)?.[1];
  const activeViewId = searchParams.get("view");
  const activeDashboardId = pathname.match(/\/dash\/([^/]+)/)?.[1];
  const isMyWork = pathname.includes("/my-work");
  const isDashboardsIndex = pathname.endsWith("/dashboards");
  const isSettings = pathname.includes("/settings");
  const isTeamOkrs = /\/okrs$/.test(pathname);
  const isMyOkrs = pathname.endsWith("/okrs/my");
  const isOkrDashboard = pathname.endsWith("/okrs/dashboard");
  const isOkrDetail = /\/okrs\/[^/]+$/.test(pathname) && !isMyOkrs && !isOkrDashboard && !isTeamOkrs;

  function toggleExpand(baseId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(baseId)) next.delete(baseId);
      else next.add(baseId);
      return next;
    });
  }

  async function createBase() {
    try {
      const base = await api.post<{ id: string }>(`/api/workspaces/${workspace.id}/bases`, { name: newBaseName || "Untitled Base" });
      setNewBaseOpen(false);
      setNewBaseName("");
      router.push(`/w/${workspace.slug}/b/${base.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create base");
    }
  }

  async function renameBase(baseId: string, currentName: string) {
    const name = prompt("Rename base", currentName);
    if (!name || name === currentName) return;
    try {
      await api.patch(`/api/bases/${baseId}`, { name });
      router.refresh();
    } catch {
      toast.error("Failed to rename base");
    }
  }

  async function archiveBase(baseId: string, name: string) {
    if (!confirm(`Archive "${name}"? It will be hidden from the sidebar but nothing is deleted - a workspace admin can restore it later.`)) return;
    try {
      await api.patch(`/api/bases/${baseId}`, { archived: true });
      router.refresh();
    } catch {
      toast.error("Failed to archive base");
    }
  }

  async function createTable(baseId: string) {
    try {
      const res = await api.post<{ table: { id: string } }>(`/api/bases/${baseId}/tables`, { name: "Task Base", template: "task" });
      router.push(`/w/${workspace.slug}/b/${baseId}/t/${res.table.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create table");
    }
  }

  async function createDashboard(baseId: string) {
    try {
      const dashboard = await api.post<{ id: string }>(`/api/bases/${baseId}/dashboards`, { name: "Untitled Dashboard" });
      router.push(`/w/${workspace.slug}/b/${baseId}/dash/${dashboard.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create dashboard");
    }
  }

  async function createView(baseId: string, tableId: string, type: string) {
    const label = NEW_VIEW_TYPES.find((v) => v.type === type)?.label ?? "View";
    const name = prompt(`Name for this ${label} view`, label) || label;
    try {
      const view = await api.post<{ id: string }>(`/api/tables/${tableId}/views`, { name, type });
      router.push(`/w/${workspace.slug}/b/${baseId}/t/${tableId}?view=${view.id}`);
      router.refresh();
    } catch {
      toast.error("Failed to create view");
    }
  }

  async function renameView(view: ViewLite) {
    const name = prompt("Rename view", view.name);
    if (!name || name === view.name) return;
    try {
      await api.patch(`/api/views/${view.id}`, { name });
      router.refresh();
    } catch {
      toast.error("Failed to rename view");
    }
  }

  async function duplicateView(baseId: string, tableId: string, view: ViewLite) {
    try {
      const source = await api.get<{ config: string }>(`/api/views/${view.id}`);
      const copy = await api.post<{ id: string }>(`/api/tables/${tableId}/views`, {
        name: `${view.name} copy`,
        type: view.type,
        config: JSON.parse(source.config || "{}"),
      });
      router.push(`/w/${workspace.slug}/b/${baseId}/t/${tableId}?view=${copy.id}`);
      router.refresh();
    } catch {
      toast.error("Failed to duplicate view");
    }
  }

  async function deleteView(view: ViewLite) {
    if (!confirm(`Delete view "${view.name}"?`)) return;
    try {
      await api.delete(`/api/views/${view.id}`);
      router.refresh();
    } catch {
      toast.error("Failed to delete view");
    }
  }

  async function reorderViews(tableId: string, orderedIds: string[]) {
    router.refresh();
    try {
      await Promise.all(orderedIds.map((id, i) => api.patch(`/api/views/${id}`, { order: i })));
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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  const name = prompt("New workspace name");
                  if (!name) return;
                  const ws = await api.post<{ slug: string }>("/api/workspaces", { name });
                  router.push(`/w/${ws.slug}`);
                }}
              >
                <Plus size={14} /> New workspace
              </DropdownMenuItem>
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
              isDashboardsIndex ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            )}
          >
            <LayoutDashboard size={14} />
            <span className="flex-1 text-left">Dashboard</span>
          </Link>

          <div className="mt-1 mb-1 px-2 flex items-center justify-between text-xs font-semibold text-neutral-400 uppercase tracking-wide">
            <span>Bases</span>
            <button onClick={() => setNewBaseOpen(true)} className="hover:text-neutral-700 dark:hover:text-neutral-200">
              <Plus size={13} />
            </button>
          </div>

          {bases.map((base) => {
            const primaryTable = base.tables.length === 1 ? base.tables[0] : null;
            return (
              <div key={base.id}>
                <div
                  className={cn(
                    "group flex items-center gap-1 rounded-md px-1.5 py-1.5 cursor-pointer",
                    activeBaseId === base.id ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  )}
                >
                  <button onClick={() => toggleExpand(base.id)} className="text-neutral-400 shrink-0">
                    {expanded.has(base.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <Link href={`/w/${workspace.slug}/b/${base.id}`} className="flex items-center gap-1.5 flex-1 min-w-0">
                    <Database size={14} style={{ color: base.color }} className="shrink-0" />
                    <span className="truncate text-neutral-800 dark:text-neutral-200 font-medium">{base.name}</span>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0"
                        title="Add view"
                      >
                        <Plus size={13} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      {primaryTable ? (
                        <>
                          <DropdownMenuLabel>New view</DropdownMenuLabel>
                          {NEW_VIEW_TYPES.map((vt) => (
                            <DropdownMenuItem key={vt.type} onSelect={() => createView(base.id, primaryTable.id, vt.type)}>
                              {vt.label}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => createDashboard(base.id)}>
                            <LayoutDashboard size={13} /> New dashboard
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <>
                          <DropdownMenuItem onSelect={() => createTable(base.id)}>
                            <Sheet size={13} /> New task base
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => createDashboard(base.id)}>
                            <LayoutDashboard size={13} /> New dashboard
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0"
                        title="Base options"
                      >
                        <MoreHorizontal size={13} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onSelect={() => renameBase(base.id, base.name)}>
                        <Pencil size={13} /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => archiveBase(base.id, base.name)} className="text-red-600 dark:text-red-400">
                        <Archive size={13} /> Archive
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {expanded.has(base.id) && (
                  <div className="ml-5 border-l border-neutral-200 dark:border-neutral-800 pl-2 space-y-0.5 mb-1">
                    {primaryTable ? (
                      <ViewList
                        base={base}
                        table={primaryTable}
                        workspaceSlug={workspace.slug}
                        activeTableId={activeTableId}
                        activeViewId={activeViewId}
                        onRename={renameView}
                        onDuplicate={(v) => duplicateView(base.id, primaryTable.id, v)}
                        onDelete={deleteView}
                        onReorder={(ids) => reorderViews(primaryTable.id, ids)}
                      />
                    ) : (
                      base.tables.map((t) => (
                        <Link
                          key={t.id}
                          href={`/w/${workspace.slug}/b/${base.id}/t/${t.id}`}
                          className={cn(
                            "flex items-center gap-1.5 rounded-md px-2 py-1 truncate",
                            activeTableId === t.id
                              ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium"
                              : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          )}
                        >
                          <Sheet size={13} className="shrink-0" />
                          <span className="truncate">{t.name}</span>
                        </Link>
                      ))
                    )}
                    {base.dashboards.map((d) => (
                      <Link
                        key={d.id}
                        href={`/w/${workspace.slug}/b/${base.id}/dash/${d.id}`}
                        className={cn(
                          "flex items-center gap-1.5 rounded-md px-2 py-1 truncate",
                          activeDashboardId === d.id
                            ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium"
                            : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        )}
                      >
                        <LayoutDashboard size={13} className="shrink-0" />
                        <span className="truncate">{d.name}</span>
                      </Link>
                    ))}
                    {base.tables.length === 0 && base.dashboards.length === 0 && (
                      <button onClick={() => createTable(base.id)} className="text-neutral-400 hover:text-neutral-600 px-2 py-1">
                        + Add task base
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="mt-3 pt-2 border-t border-neutral-200 dark:border-neutral-800 space-y-0.5">
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
                <div className="h-6 w-6 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[11px] font-medium shrink-0">
                  {initials(user.name)}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="truncate text-neutral-800 dark:text-neutral-200 font-medium">{user.name}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-52">
              <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
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

      <Dialog open={newBaseOpen} onOpenChange={setNewBaseOpen}>
        <DialogContent>
          <DialogTitle>New base</DialogTitle>
          <Input autoFocus value={newBaseName} onChange={(e) => setNewBaseName(e.target.value)} placeholder="e.g. HR Operations" onKeyDown={(e) => e.key === "Enter" && createBase()} />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setNewBaseOpen(false)}>Cancel</Button>
            <Button onClick={createBase}>Create base</Button>
          </div>
        </DialogContent>
      </Dialog>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} workspaceId={workspace.id} workspaceSlug={workspace.slug} />
    </div>
  );
}

function ViewList({
  base,
  table,
  workspaceSlug,
  activeTableId,
  activeViewId,
  onRename,
  onDuplicate,
  onDelete,
  onReorder,
}: {
  base: BaseLite;
  table: TableLite;
  workspaceSlug: string;
  activeTableId: string | undefined;
  activeViewId: string | null;
  onRename: (view: ViewLite) => void;
  onDuplicate: (view: ViewLite) => void;
  onDelete: (view: ViewLite) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = table.views.map((v) => v.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  const isDefaultViewActive = activeTableId === table.id && !activeViewId;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={table.views.map((v) => v.id)} strategy={verticalListSortingStrategy}>
        {table.views.map((view, i) => (
          <ViewRow
            key={view.id}
            base={base}
            table={table}
            view={view}
            workspaceSlug={workspaceSlug}
            active={activeTableId === table.id && (activeViewId === view.id || (isDefaultViewActive && i === 0))}
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
  base,
  table,
  view,
  workspaceSlug,
  active,
  onRename,
  onDuplicate,
  onDelete,
}: {
  base: BaseLite;
  table: TableLite;
  view: ViewLite;
  workspaceSlug: string;
  active: boolean;
  onRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: view.id });
  const Icon = VIEW_ICONS[view.type] ?? Sheet;
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group/view flex items-center rounded-md", isDragging && "opacity-50 relative z-10")}
    >
      <span {...attributes} {...listeners} className="text-neutral-300 dark:text-neutral-700 cursor-grab opacity-0 group-hover/view:opacity-100 shrink-0 w-3 -ml-0.5">
        <GripVertical size={12} />
      </span>
      <Link
        href={`/w/${workspaceSlug}/b/${base.id}/t/${table.id}?view=${view.id}`}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-1.5 py-1 truncate flex-1 min-w-0",
          active
            ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium"
            : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
        )}
      >
        <Icon size={13} />
        <span className="truncate">{view.name}</span>
      </Link>
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
    </div>
  );
}
