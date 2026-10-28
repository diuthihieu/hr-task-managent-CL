"use client";
// Pieces of the workspace sidebar: a project's view list and rows, section labels, nav links,
// and the remembered sidebar preferences.
import Link from "next/link";
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
import { Sheet, Kanban as KanbanIcon, Calendar as CalendarIcon, GanttChartSquare, GalleryHorizontal, FileInput, Grid2x2, MoreHorizontal, Pencil, Copy, Trash2, GripVertical, BarChart3 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const VIEW_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  grid: Sheet,
  kanban: KanbanIcon,
  calendar: CalendarIcon,
  gantt: GanttChartSquare,
  gallery: GalleryHorizontal,
  form: FileInput,
  eisenhower: Grid2x2,
  report: BarChart3,
};

export interface ViewLite { id: string; name: string; type: string; canDelete: boolean }
export interface ProjectLite { id: string; name: string; color: string; icon: string | null; views: ViewLite[] }

export function ViewList({
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

export function ViewRow({
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

export function readPref(key: string) {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* private mode: the choice just isn't remembered */
  }
}

/** Group label; in compact mode a thin divider instead. */
export function NavSection({ label, compact, first }: { label: string; compact: boolean; first?: boolean }) {
  return (
    <div className={cn(first ? "pt-1" : "pt-3.5", "pb-1")}>
      <span className={cn("block px-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400", compact && "lg:hidden")}>{label}</span>
      {compact && !first && <span className="hidden lg:block mx-auto h-px w-6 bg-neutral-200 dark:bg-neutral-800" aria-hidden />}
    </div>
  );
}

/** One sidebar entry: same icon size and stroke everywhere; icon-only with a tooltip when compact. */
export function NavLink({ href, active, icon: Icon, label, compact, badge, testId, className }: { href: string; active: boolean; icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>; label: string; compact: boolean; badge?: React.ReactNode; testId?: string; className?: string }) {
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
