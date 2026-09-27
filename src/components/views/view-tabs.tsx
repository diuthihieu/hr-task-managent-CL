"use client";
import { useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Sheet, Kanban, Calendar, GanttChartSquare, GalleryHorizontal, FileInput, Grid2x2, Trash2, MoreHorizontal, Pencil, Copy, BarChart3 } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";
import type { ViewRow } from "@/types";
import { cn } from "@/lib/utils";

const VIEW_ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  grid: Sheet,
  kanban: Kanban,
  calendar: Calendar,
  gantt: GanttChartSquare,
  gallery: GalleryHorizontal,
  form: FileInput,
  eisenhower: Grid2x2,
  report: BarChart3,
};

const VIEW_TYPES: { type: string; label: MessageKey }[] = [
  { type: "grid", label: "view.type.grid" },
  { type: "kanban", label: "view.type.kanban" },
  { type: "calendar", label: "view.type.calendar" },
  { type: "gantt", label: "view.type.gantt" },
  { type: "gallery", label: "view.type.gallery" },
  { type: "form", label: "view.type.form" },
  { type: "eisenhower", label: "view.type.eisenhower" },
  { type: "report", label: "view.type.report" },
];

export function ViewTabs({
  views,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onDuplicate,
  onReorder,
}: {
  views: ViewRow[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string, type: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const { t } = useT();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = views.map((v) => v.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    onReorder(arrayMove(ids, oldIndex, newIndex));
  }

  return (
    <div className="flex items-center gap-0.5 px-3 h-10 border-b border-neutral-200 dark:border-neutral-800 shrink-0 overflow-x-auto thin-scroll">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={views.map((v) => v.id)} strategy={horizontalListSortingStrategy}>
          {views.map((view) => (
            <ViewTab
              key={view.id}
              view={view}
              active={view.id === activeId}
              renaming={renamingId === view.id}
              renameValue={renameValue}
              onRenameValueChange={setRenameValue}
              canDelete={views.length > 1}
              onSelect={() => onSelect(view.id)}
              onStartRename={() => {
                setRenamingId(view.id);
                setRenameValue(view.name);
              }}
              onCommitRename={() => {
                onRename(view.id, renameValue || view.name);
                setRenamingId(null);
              }}
              onDuplicate={() => onDuplicate(view.id)}
              onDelete={() => {
                if (confirm(t("common.confirmDelete", { name: view.name }))) onDelete(view.id);
              }}
            />
          ))}
        </SortableContext>
      </DndContext>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex items-center gap-1 h-7 px-2 rounded-md text-sm text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-900 ml-1">
            <Plus size={14} /> {t("nav.addView")}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {VIEW_TYPES.map((vt) => {
            const Icon = VIEW_ICONS[vt.type] ?? Sheet;
            return (
              <DropdownMenuItem key={vt.type} onSelect={() => onCreate(t(vt.label), vt.type)} data-testid={`add-view-${vt.type}`}>
                <Icon size={13} /> {t(vt.label)}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ViewTab({
  view,
  active,
  renaming,
  renameValue,
  onRenameValueChange,
  canDelete,
  onSelect,
  onStartRename,
  onCommitRename,
  onDuplicate,
  onDelete,
}: {
  view: ViewRow;
  active: boolean;
  renaming: boolean;
  renameValue: string;
  onRenameValueChange: (v: string) => void;
  canDelete: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: view.id });
  const Icon = VIEW_ICONS[view.type] ?? Sheet;

  if (renaming) {
    return (
      <input
        autoFocus
        value={renameValue}
        onChange={(e) => onRenameValueChange(e.target.value)}
        onBlur={onCommitRename}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="h-7 w-28 text-sm rounded-md border border-indigo-400 px-1.5 bg-white dark:bg-neutral-900"
      />
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("group flex items-center rounded-md shrink-0", isDragging && "opacity-50 z-10 relative")}
      {...attributes}
      {...listeners}
    >
      <button
        onClick={onSelect}
        onDoubleClick={onStartRename}
        className={cn(
          "flex items-center gap-1.5 h-7 pl-2.5 pr-1 rounded-md text-sm font-medium",
          active ? "bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-50" : "text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-900"
        )}
      >
        <Icon size={13} />
        {view.name}
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            className={cn("h-7 w-5 flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200", active ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
          >
            <MoreHorizontal size={13} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={onStartRename}>
            <Pencil size={13} /> {t("common.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDuplicate}>
            <Copy size={13} /> {t("common.duplicate")}
          </DropdownMenuItem>
          {canDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDelete} className="text-red-600 dark:text-red-400">
                <Trash2 size={13} /> {t("common.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
