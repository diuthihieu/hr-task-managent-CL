"use client";
import { useEffect, useState } from "react";
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
import { GripVertical, Pencil, Copy, Trash2, ExternalLink, Sheet, Kanban, Calendar, GanttChartSquare, GalleryHorizontal, FileInput, Grid2x2, BarChart3 } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { SettingsSection } from "./settings-shell";
import { useProjectPicker } from "./project-picker";
import type { ViewRow } from "@/types";
import { useT } from "@/components/i18n-provider";

const VIEW_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  grid: Sheet,
  kanban: Kanban,
  calendar: Calendar,
  gantt: GanttChartSquare,
  gallery: GalleryHorizontal,
  form: FileInput,
  eisenhower: Grid2x2,
  report: BarChart3,
};

export function SettingsViews({ workspaceId, workspaceSlug, canManage }: { workspaceId: string; workspaceSlug: string; canManage: boolean }) {
  const { t } = useT();
  const { projects, projectId, project, picker } = useProjectPicker(workspaceId);
  const [views, setViews] = useState<ViewRow[]>([]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  useEffect(() => {
    if (!projectId) return;
    api.get<ViewRow[]>(`/api/projects/${projectId}/views`).then(setViews).catch(() => setViews([]));
  }, [projectId]);

  if (!projects) return <div className="p-6 text-sm text-neutral-400">{t("common.loading")}</div>;
  if (!project) return <div className="p-6 text-sm text-neutral-400">{t("sv.noProjects")}</div>;
  const table = { views };
  const setTable = (fn: (t: { views: ViewRow[] }) => { views: ViewRow[] } | null) => setViews((prev) => fn({ views: prev })?.views ?? prev);

  async function rename(view: ViewRow) {
    const name = prompt("Rename view", view.name);
    if (!name || name === view.name) return;
    try {
      await api.patch(`/api/views/${view.id}`, { name });
      setTable((t) => (t ? { ...t, views: t.views.map((v) => (v.id === view.id ? { ...v, name } : v)) } : t));
    } catch {
      toast.error(t("common.failed"));
    }
  }

  async function duplicate(view: ViewRow) {
    if (!table) return;
    try {
      const source = await api.get<{ config: string }>(`/api/views/${view.id}`);
      const copy = await api.post<ViewRow>(`/api/projects/${projectId}/views`, { name: `${view.name} copy`, type: view.type, config: JSON.parse(source.config || "{}") });
      setTable((t) => (t ? { ...t, views: [...t.views, copy] } : t));
      toast.success(t("sv.duplicated"));
    } catch {
      toast.error(t("common.failed"));
    }
  }

  async function remove(view: ViewRow) {
    if (!table || table.views.length <= 1) {
      toast.error(t("sv.needOne"));
      return;
    }
    if (!confirm(t("common.confirmDelete", { name: view.name }))) return;
    try {
      await api.delete(`/api/views/${view.id}`);
      setTable((t) => (t ? { ...t, views: t.views.filter((v) => v.id !== view.id) } : t));
    } catch {
      toast.error(t("common.failed"));
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = table.views.map((v) => v.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    const reordered = arrayMove(table.views, oldIndex, newIndex);
    setViews(reordered);
    Promise.all(reordered.map((v, i) => api.patch(`/api/views/${v.id}`, { order: i }))).catch(() => toast.error(t("common.failed")));
  }

  return (
    <SettingsSection title={t("set.views")} description={t("sv.desc", { project: project.name })}>
      {picker}
      {!canManage && <p className="text-xs text-neutral-400 mb-2">{t("sv.readOnly")}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={table.views.map((v) => v.id)} strategy={verticalListSortingStrategy}>
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-100 dark:divide-neutral-900 max-w-2xl">
            {table.views.map((view) => (
              <ViewSettingsRow
                key={view.id}
                view={view}
                href={`/w/${workspaceSlug}/p/${projectId}?view=${view.id}`}
                canManage={canManage}
                onRename={() => rename(view)}
                onDuplicate={() => duplicate(view)}
                onDelete={() => remove(view)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </SettingsSection>
  );
}

function ViewSettingsRow({ view, href, canManage, onRename, onDuplicate, onDelete }: { view: ViewRow; href: string; canManage: boolean; onRename: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const { t } = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: view.id, disabled: !canManage });
  const Icon = VIEW_ICONS[view.type] ?? Sheet;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={isDragging ? "opacity-50 relative z-10 bg-white dark:bg-neutral-900" : ""}>
      <div className="flex items-center gap-2 px-3 py-2">
        {canManage && (
          <span {...attributes} {...listeners} className="text-neutral-300 dark:text-neutral-700 cursor-grab shrink-0">
            <GripVertical size={13} />
          </span>
        )}
        <Icon size={14} className="text-neutral-400 shrink-0" />
        <span className="flex-1 min-w-0 truncate text-sm text-neutral-800 dark:text-neutral-100">{view.name}</span>
        <span className="text-[11px] text-neutral-400 shrink-0 capitalize">{view.type}</span>
        <Link href={href} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0" title={t("sv.open")}>
          <ExternalLink size={13} />
        </Link>
        {canManage && (
          <>
        <button onClick={onRename} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0" title={t("common.rename")}>
          <Pencil size={13} />
        </button>
        <button onClick={onDuplicate} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0" title={t("common.duplicate")}>
          <Copy size={13} />
        </button>
        <button onClick={onDelete} className="text-neutral-400 hover:text-red-600 shrink-0" title={t("common.delete")}>
          <Trash2 size={13} />
        </button>
          </>
        )}
      </div>
    </div>
  );
}
