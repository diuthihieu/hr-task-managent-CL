"use client";
// Home as widgets. Everyone arranges their own Home: drag widgets in from the
// side panel, reorder, resize (S / M / L / XL), pick a style, start from one
// of five suggested layouts, or package the design as a template that is
// private, shared with chosen people, or public in the workspace.
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DndContext, DragOverlay, PointerSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LayoutGrid, X, GripVertical, Plus, Settings2, RotateCcw, Save, Copy, Trash2, Share2, Check, Users, Globe, Lock, Loader2, Sparkles } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";
import { METRICS, PRESETS, PRESET_KEYS, SIZE_CLASS, WIDGETS, WIDGET_GROUPS, WIDGET_TYPES, newWidget, type HomeWidget, type PresetKey, type WidgetConfig, type WidgetSize, type WidgetType } from "@/lib/home-widgets";
import { CommandCenter } from "./command-center";
import { ActivityWidget, DashboardWidget, DeadlinesWidget, FocusTimeWidget, MetricWidget, NoteWidget, OkrsWidget, ProjectsWidget, type HomeData } from "./home-widgets";

interface TemplateDto {
  id: string;
  name: string;
  description: string | null;
  visibility: "private" | "workspace" | "shared";
  owner: { id: string; name: string };
  widgets: HomeWidget[];
  sharedWith: { id: string; name: string }[];
  useCount: number;
  mine: boolean;
  canDelete: boolean;
}
type PanelTab = "widgets" | "layouts" | "templates";

const COMMAND_PARTS = new Set<WidgetType>(["kpis", "focus", "my_day", "attention", "waiting", "completed", "my_tasks"]);

function WidgetView({ w, d }: { w: HomeWidget; d: HomeData }) {
  if (COMMAND_PARTS.has(w.type))
    return (
      <CommandCenter
        part={w.type as "kpis"}
        variant={w.style}
        workspaceId={d.workspaceId}
        base={d.base}
        today={d.today}
        soon={d.soon}
        locale={d.locale}
        tasks={d.tasks}
        waiting={d.waiting}
        doneLast30={d.doneLast30}
      />
    );
  switch (w.type) {
    case "okrs":
      return <OkrsWidget d={d} style={w.style} />;
    case "activity":
      return <ActivityWidget d={d} style={w.style} />;
    case "projects":
      return <ProjectsWidget d={d} style={w.style} />;
    case "deadlines":
      return <DeadlinesWidget d={d} style={w.style} />;
    case "focus_time":
      return <FocusTimeWidget d={d} style={w.style} />;
    case "metric":
      return <MetricWidget d={d} style={w.style} config={w.config} />;
    case "dashboard":
      return <DashboardWidget d={d} style={w.style} config={w.config} />;
    case "note":
      return <NoteWidget style={w.style} config={w.config} />;
    default:
      return null;
  }
}

/** A small picture of a layout: one block per widget on the 4-column grid. */
export function LayoutThumb({ widgets, className }: { widgets: HomeWidget[]; className?: string }) {
  const span: Record<WidgetSize, number> = { s: 1, m: 2, l: 3, xl: 4 };
  return (
    <div className={cn("grid grid-cols-4 gap-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 p-1", className)} aria-hidden>
      {widgets.slice(0, 14).map((w, i) => (
        <span key={i} className={cn("h-2.5 rounded-sm", WIDGETS[w.type].group === "metrics" ? "bg-indigo-400" : WIDGETS[w.type].group === "tasks" ? "bg-indigo-300" : "bg-indigo-200 dark:bg-indigo-700")} style={{ gridColumn: `span ${span[w.size]} / span ${span[w.size]}` }} />
      ))}
    </div>
  );
}

export function HomeBoard({ data, initial, custom, role }: { data: HomeData; initial: HomeWidget[]; custom: boolean; role: string }) {
  const { t } = useT();
  const router = useRouter();
  const params = useSearchParams();
  const [widgets, setWidgets] = useState<HomeWidget[]>(initial);
  const [isCustom, setIsCustom] = useState(custom);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<HomeWidget[]>(initial);
  const [tab, setTab] = useState<PanelTab>("widgets");
  const [saving, setSaving] = useState(false);
  const [usedTemplate, setUsedTemplate] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [tplVersion, setTplVersion] = useState(0);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  // Opened from a "template shared with you" notification.
  const customize = params.get("customize");
  useEffect(() => {
    if (!customize) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- open the editor on the requested tab once
    setEditing(true);
    setDraft(widgets);
    if (customize === "templates" || customize === "layouts") setTab(customize);
    router.replace("?", { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per request
  }, [customize]);

  const shown = editing ? draft : widgets;
  function start() {
    setDraft(widgets);
    setUsedTemplate(null);
    setEditing(true);
  }
  function cancel() {
    setEditing(false);
    setDraft(widgets);
  }
  async function save() {
    setSaving(true);
    try {
      const r = await api.put<{ widgets: HomeWidget[] }>(`/api/workspaces/${data.workspaceId}/home-layout`, { widgets: draft, templateId: usedTemplate ?? undefined });
      setWidgets(r.widgets);
      setIsCustom(true);
      setEditing(false);
      toast.success(t("hb.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }
  async function resetDefault() {
    if (!confirm(t("hb.resetConfirm"))) return;
    const r = await api.delete<{ widgets: HomeWidget[] }>(`/api/workspaces/${data.workspaceId}/home-layout`);
    setWidgets(r.widgets);
    setDraft(r.widgets);
    setIsCustom(false);
    setEditing(false);
  }
  const update = (id: string, patch: Partial<HomeWidget>) => setDraft((prev) => prev.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const add = (type: WidgetType, index?: number) => {
    const w = newWidget(type);
    setDraft((prev) => {
      const next = [...prev];
      next.splice(index ?? next.length, 0, w);
      return next;
    });
    return w;
  };
  const applyWidgets = (list: HomeWidget[], templateId: string | null) => {
    if (draft.length && !confirm(t("hb.replaceConfirm"))) return;
    // Fresh ids so a layout can be applied twice without clashes.
    setDraft(list.map((w) => ({ ...w, id: `${w.type}-${Math.random().toString(36).slice(2, 9)}` })));
    setUsedTemplate(templateId);
  };

  function onDragStart(e: DragStartEvent) {
    setDragging(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const a = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (a.startsWith("new:")) {
      if (!over) return;
      const idx = draft.findIndex((w) => w.id === over);
      add(a.slice(4) as WidgetType, idx >= 0 ? idx : undefined);
      return;
    }
    if (!over || a === over) return;
    const from = draft.findIndex((w) => w.id === a);
    const to = draft.findIndex((w) => w.id === over);
    if (from >= 0 && to >= 0) setDraft(arrayMove(draft, from, to));
  }

  const board = (
    <div className={cn("grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-stretch", editing && "min-h-[50vh] rounded-2xl outline-2 outline-dashed outline-offset-8 outline-indigo-200 dark:outline-indigo-900")} data-testid="home-board">
      {shown.map((w) => (editing ? <EditableWidget key={w.id} w={w} d={data} onChange={(p) => update(w.id, p)} onRemove={() => setDraft((prev) => prev.filter((x) => x.id !== w.id))} /> : (
        <div key={w.id} className={SIZE_CLASS[w.size]} data-widget={w.type}>
          <WidgetView w={w} d={data} />
        </div>
      )))}
      {editing && <CanvasEnd empty={!shown.length} />}
    </div>
  );

  return (
    <div className={cn(editing && "lg:pr-[380px]")}>
      <div className="flex items-center justify-end gap-2 -mt-2 mb-3">
        {!editing && (
          <Button variant="outline" size="sm" onClick={start} data-testid="hb-customize">
            <LayoutGrid size={13} /> {t("hb.customize")}
          </Button>
        )}
        {!editing && isCustom && <span className="text-[11px] text-neutral-400">{t("hb.customized")}</span>}
      </div>
      {editing ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
          <SortableContext items={draft.map((w) => w.id)} strategy={rectSortingStrategy}>
            {board}
          </SortableContext>
          <EditorPanel
            workspaceId={data.workspaceId}
            role={role}
            tab={tab}
            setTab={setTab}
            draft={draft}
            onAdd={(type) => add(type)}
            onApply={applyWidgets}
            onSave={save}
            onCancel={cancel}
            onReset={resetDefault}
            onSaveTemplate={() => setSaveTplOpen(true)}
            saving={saving}
            tplVersion={tplVersion}
          />
          <DragOverlay>{dragging?.startsWith("new:") ? <div className="rounded-xl bg-indigo-600 text-white text-sm px-3 py-2 shadow-xl">{t(`hb.w.${dragging.slice(4)}` as MessageKey)}</div> : null}</DragOverlay>
        </DndContext>
      ) : (
        board
      )}
      {saveTplOpen && (
        <SaveTemplateDialog
          workspaceId={data.workspaceId}
          role={role}
          widgets={draft}
          onClose={() => setSaveTplOpen(false)}
          onSaved={() => {
            setTab("templates");
            setTplVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}

function CanvasEnd({ empty }: { empty: boolean }) {
  const { t } = useT();
  const { setNodeRef, isOver } = useDroppable({ id: "canvas-end" });
  return (
    <div ref={setNodeRef} className={cn("col-span-1 md:col-span-2 xl:col-span-4 rounded-2xl border-2 border-dashed flex items-center justify-center text-sm text-neutral-400", empty ? "h-48" : "h-20", isOver ? "border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30 text-indigo-600" : "border-neutral-200 dark:border-neutral-800")} data-testid="hb-drop">
      <Plus size={14} className="mr-1" /> {t("hb.dropHere")}
    </div>
  );
}

function EditableWidget({ w, d, onChange, onRemove }: { w: HomeWidget; d: HomeData; onChange: (p: Partial<HomeWidget>) => void; onRemove: () => void }) {
  const { t } = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({ id: w.id });
  const def = WIDGETS[w.type];
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn(SIZE_CLASS[w.size], "relative group", isDragging && "opacity-40 z-20")} data-testid="hb-widget" data-widget={w.type} data-size={w.size}>
      <div className={cn("flex flex-wrap items-center gap-1 rounded-t-xl bg-indigo-600 text-white px-2 py-1 text-xs", isOver && "ring-2 ring-indigo-300")}>
        <button {...attributes} {...listeners} className="cursor-grab p-0.5 rounded hover:bg-white/15" aria-label={t("hb.move")} data-testid="hb-grip">
          <GripVertical size={13} />
        </button>
        <span className="font-medium truncate flex-1 min-w-0">{w.config?.title || t(`hb.w.${w.type}` as MessageKey)}</span>
        <span className="flex rounded-md bg-white/15 p-0.5" role="group" aria-label={t("hb.size")}>
          {def.sizes.map((sz) => (
            <button key={sz} onClick={() => onChange({ size: sz })} className={cn("px-1.5 rounded font-semibold uppercase", w.size === sz ? "bg-white text-indigo-700" : "hover:bg-white/20")} title={t(`hb.size.${sz}` as MessageKey)} data-testid={`hb-size-${sz}`}>
              {sz}
            </button>
          ))}
        </span>
        {def.styles.length > 1 && (
          <select value={w.style} onChange={(e) => onChange({ style: e.target.value })} className="h-6 rounded bg-white/15 text-white text-xs px-1 outline-none [&>option]:text-neutral-900" aria-label={t("hb.style")} data-testid="hb-style">
            {def.styles.map((st) => (
              <option key={st} value={st}>
                {t(`hb.style.${st}` as MessageKey)}
              </option>
            ))}
          </select>
        )}
        <WidgetSettings w={w} d={d} onChange={(config) => onChange({ config })} />
        <button onClick={onRemove} className="p-0.5 rounded hover:bg-white/15" aria-label={t("hb.remove")} data-testid="hb-remove">
          <X size={13} />
        </button>
      </div>
      <div className="pointer-events-none select-none rounded-b-2xl ring-1 ring-indigo-200 dark:ring-indigo-900 [&>*]:rounded-t-none">
        <WidgetView w={w} d={d} />
      </div>
    </div>
  );
}

/** Per-widget settings: which metric, which dashboard / chart, a note's text, a custom title. */
function WidgetSettings({ w, d, onChange }: { w: HomeWidget; d: HomeData; onChange: (c: WidgetConfig) => void }) {
  const { t } = useT();
  const [dashboards, setDashboards] = useState<{ id: string; name: string; blocks?: { id: string; title: string }[] }[] | null>(null);
  const [blocks, setBlocks] = useState<{ id: string; title: string }[]>([]);
  const cfg = w.config ?? {};
  const needs = w.type === "metric" || w.type === "dashboard" || w.type === "note";
  useEffect(() => {
    if (w.type !== "dashboard" || !cfg.dashboardId) return;
    api
      .get<{ blocks: { id: string; title: string }[] }>(`/api/dashboards/${cfg.dashboardId}`)
      .then((x) => setBlocks(x.blocks))
      .catch(() => setBlocks([]));
  }, [w.type, cfg.dashboardId]);
  if (!needs && w.type !== "okrs") return null;
  const sel = "h-8 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm";
  return (
    <Popover
      onOpenChange={(o) => {
        if (o && w.type === "dashboard" && !dashboards) api.get<{ id: string; name: string }[]>(`/api/workspaces/${d.workspaceId}/dashboards`).then(setDashboards).catch(() => setDashboards([]));
      }}
    >
      <PopoverTrigger asChild>
        <button className="p-0.5 rounded hover:bg-white/15" aria-label={t("hb.settings")} data-testid="hb-settings">
          <Settings2 size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3 text-sm">
        <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
          {t("hb.cfg.title")}
          <Input className="mt-1 h-8" value={cfg.title ?? ""} maxLength={80} placeholder={t(`hb.w.${w.type}` as MessageKey)} onChange={(e) => onChange({ ...cfg, title: e.target.value || undefined })} />
        </label>
        {w.type === "metric" && (
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {t("hb.cfg.metric")}
            <select className={cn(sel, "mt-1")} value={cfg.metric ?? "overdue"} onChange={(e) => onChange({ ...cfg, metric: e.target.value as WidgetConfig["metric"] })} data-testid="hb-metric">
              {METRICS.map((m) => (
                <option key={m} value={m}>
                  {t(`home.metric.${m}` as MessageKey)}
                </option>
              ))}
            </select>
          </label>
        )}
        {w.type === "dashboard" && (
          <>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {t("hb.cfg.dashboard")}
              <select className={cn(sel, "mt-1")} value={cfg.dashboardId ?? ""} onChange={(e) => onChange({ ...cfg, dashboardId: e.target.value || undefined, blockId: undefined })} data-testid="hb-dashboard">
                <option value="">{dashboards ? (dashboards.length ? t("hb.cfg.pickDashboard") : t("hb.cfg.noDashboards")) : t("common.loading")}</option>
                {(dashboards ?? []).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
            {w.style === "single" && cfg.dashboardId && (
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                {t("hb.cfg.chart")}
                <select className={cn(sel, "mt-1")} value={cfg.blockId ?? ""} onChange={(e) => onChange({ ...cfg, blockId: e.target.value || undefined })}>
                  <option value="">{t("hb.cfg.firstChart")}</option>
                  {blocks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title || "—"}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
        {w.type === "note" && (
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {t("hb.cfg.text")}
            <Textarea className="mt-1" rows={4} maxLength={2000} value={cfg.text ?? ""} onChange={(e) => onChange({ ...cfg, text: e.target.value })} data-testid="hb-note-text" />
          </label>
        )}
      </PopoverContent>
    </Popover>
  );
}

function PaletteItem({ type, onAdd }: { type: WidgetType; onAdd: () => void }) {
  const { t } = useT();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `new:${type}` });
  const def = WIDGETS[type];
  return (
    <div ref={setNodeRef} className={cn("flex items-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2.5 py-2", isDragging && "opacity-40")} data-testid="hb-palette-item" data-widget={type}>
      <button {...attributes} {...listeners} className="cursor-grab text-neutral-400 hover:text-indigo-600" aria-label={t("hb.dragIn")}>
        <GripVertical size={14} />
      </button>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{t(`hb.w.${type}` as MessageKey)}</div>
        <div className="text-[11px] text-neutral-500 line-clamp-2">{t(`hb.wd.${type}` as MessageKey)}</div>
        <div className="flex flex-wrap gap-1 mt-1">
          {def.styles.map((s) => (
            <span key={s} className="rounded bg-neutral-100 dark:bg-neutral-800 px-1 text-[10px] text-neutral-500">
              {t(`hb.style.${s}` as MessageKey)}
            </span>
          ))}
          <span className="rounded bg-indigo-50 dark:bg-indigo-950 px-1 text-[10px] text-indigo-600">{def.sizes.map((s) => s.toUpperCase()).join(" ")}</span>
        </div>
      </div>
      <button onClick={onAdd} className="h-7 w-7 rounded-md flex items-center justify-center text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950" aria-label={t("hb.add")} data-testid="hb-add">
        <Plus size={15} />
      </button>
    </div>
  );
}

function EditorPanel(p: {
  workspaceId: string;
  role: string;
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  draft: HomeWidget[];
  onAdd: (type: WidgetType) => void;
  onApply: (list: HomeWidget[], templateId: string | null) => void;
  onSave: () => void;
  onCancel: () => void;
  onReset: () => void;
  onSaveTemplate: () => void;
  saving: boolean;
  tplVersion: number;
}) {
  const { t } = useT();
  const present = new Set(p.draft.map((w) => w.type));
  return (
    <aside className="fixed z-40 top-0 right-0 h-full w-full sm:w-[380px] bg-neutral-50 dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800 shadow-2xl flex flex-col" data-testid="hb-panel">
      <div className="h-14 shrink-0 px-4 flex items-center gap-2 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <LayoutGrid size={16} className="text-indigo-600" />
        <span className="font-semibold text-sm flex-1">{t("hb.title")}</span>
        <button onClick={p.onCancel} className="h-8 w-8 rounded-md flex items-center justify-center text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={t("common.close")}>
          <X size={16} />
        </button>
      </div>
      <div className="flex border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2" role="tablist">
        {(["widgets", "layouts", "templates"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={p.tab === k} onClick={() => p.setTab(k)} className={cn("flex-1 h-10 text-sm font-medium border-b-2 -mb-px", p.tab === k ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-neutral-500")} data-testid={`hb-tab-${k}`}>
            {t(`hb.tab.${k}` as MessageKey)}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll p-3 space-y-4">
        {p.tab === "widgets" && (
          <>
            <p className="text-xs text-neutral-500">{t("hb.widgetsHint")}</p>
            {WIDGET_GROUPS.map((g) => {
              const items = WIDGET_TYPES.filter((type) => WIDGETS[type].group === g && ((WIDGETS[type] as { multiple?: boolean }).multiple || !present.has(type)));
              if (!items.length) return null;
              return (
                <div key={g}>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400 mb-1.5">{t(`hb.group.${g}` as MessageKey)}</div>
                  <div className="space-y-1.5">
                    {items.map((type) => (
                      <PaletteItem key={type} type={type} onAdd={() => p.onAdd(type)} />
                    ))}
                  </div>
                </div>
              );
            })}
          </>
        )}
        {p.tab === "layouts" && (
          <div className="space-y-2">
            <p className="text-xs text-neutral-500">{t("hb.layoutsHint")}</p>
            {PRESET_KEYS.map((k: PresetKey) => (
              <button key={k} onClick={() => p.onApply(PRESETS[k], null)} className="w-full text-left rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 hover:border-indigo-300" data-testid={`hb-preset-${k}`}>
                <div className="flex items-center gap-2">
                  <Sparkles size={13} className="text-indigo-600" />
                  <span className="text-sm font-semibold">{t(`hb.preset.${k}` as MessageKey)}</span>
                </div>
                <p className="text-xs text-neutral-500 mt-0.5">{t(`hb.presetd.${k}` as MessageKey)}</p>
                <LayoutThumb widgets={PRESETS[k]} className="mt-2" />
              </button>
            ))}
          </div>
        )}
        {p.tab === "templates" && <TemplatesTab key={p.tplVersion} workspaceId={p.workspaceId} role={p.role} onApply={p.onApply} onNew={p.onSaveTemplate} />}
      </div>
      <div className="shrink-0 border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 space-y-2">
        <div className="flex gap-2">
          <Button className="flex-1" onClick={p.onSave} disabled={p.saving} data-testid="hb-save">
            {p.saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} {t("hb.save")}
          </Button>
          <Button variant="outline" onClick={p.onCancel}>
            {t("common.cancel")}
          </Button>
        </div>
        <div className="flex justify-between text-xs">
          <button onClick={p.onSaveTemplate} disabled={!p.draft.length} className="inline-flex items-center gap-1 text-indigo-600 hover:underline disabled:opacity-40" data-testid="hb-save-template">
            <Save size={12} /> {t("hb.saveTemplate")}
          </button>
          <button onClick={p.onReset} className="inline-flex items-center gap-1 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
            <RotateCcw size={12} /> {t("hb.reset")}
          </button>
        </div>
      </div>
    </aside>
  );
}

function TemplatesTab({ workspaceId, role, onApply, onNew }: { workspaceId: string; role: string; onApply: (list: HomeWidget[], templateId: string | null) => void; onNew: () => void }) {
  const { t } = useT();
  const [scope, setScope] = useState<"mine" | "shared">("mine");
  const [data, setData] = useState<{ mine: TemplateDto[]; shared: TemplateDto[] } | null>(null);
  const [sharing, setSharing] = useState<TemplateDto | null>(null);
  const load = () => api.get<{ mine: TemplateDto[]; shared: TemplateDto[] }>(`/api/workspaces/${workspaceId}/home-templates`).then(setData).catch(() => setData({ mine: [], shared: [] }));
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per workspace (and after changes below)
  }, [workspaceId]);
  const list = data?.[scope] ?? [];
  const visIcon = (v: TemplateDto["visibility"]) => (v === "workspace" ? Globe : v === "shared" ? Users : Lock);
  async function copy(x: TemplateDto) {
    await api.post(`/api/home-templates/${x.id}/copy`).catch((e) => toast.error(e.message));
    toast.success(t("hb.tpl.copied"));
    setScope("mine");
    load();
  }
  async function remove(x: TemplateDto) {
    if (!confirm(t("hb.tpl.deleteConfirm", { name: x.name }))) return;
    await api.delete(`/api/home-templates/${x.id}`).catch((e) => toast.error(e.message));
    load();
  }
  return (
    <div className="space-y-3" data-testid="hb-templates">
      <div className="flex items-center gap-2">
        <span className="flex rounded-lg bg-neutral-100 dark:bg-neutral-800 p-0.5 text-xs flex-1">
          {(["mine", "shared"] as const).map((sc) => (
            <button key={sc} onClick={() => setScope(sc)} className={cn("flex-1 px-2 py-1 rounded-md", scope === sc ? "bg-white dark:bg-neutral-900 shadow-sm text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-500")} data-testid={`hb-tpl-${sc}`}>
              {t(`hb.tpl.${sc}` as MessageKey)} <span className="opacity-60">{data?.[sc].length ?? 0}</span>
            </button>
          ))}
        </span>
        <Button size="sm" variant="outline" onClick={onNew} data-testid="hb-tpl-new">
          <Plus size={12} /> {t("hb.tpl.new")}
        </Button>
      </div>
      {!data ? (
        <Loader2 size={16} className="animate-spin text-neutral-400" />
      ) : list.length === 0 ? (
        <p className="text-xs text-neutral-500">{t(scope === "mine" ? "hb.tpl.emptyMine" : "hb.tpl.emptyShared")}</p>
      ) : (
        list.map((x) => {
          const Icon = visIcon(x.visibility);
          return (
            <div key={x.id} className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3" data-testid="hb-tpl-item">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{x.name}</div>
                  <div className="text-[11px] text-neutral-500 flex items-center gap-1">
                    <Icon size={11} /> {t(`hb.vis.${x.visibility}` as MessageKey)}
                    {!x.mine && <span>{t("hb.tpl.by", { name: x.owner.name })}</span>}
                    {x.useCount > 0 && <span>{t("hb.tpl.uses", { n: x.useCount })}</span>}
                  </div>
                  {x.description && <p className="text-xs text-neutral-500 mt-1 line-clamp-2">{x.description}</p>}
                </div>
              </div>
              <LayoutThumb widgets={x.widgets} className="mt-2" />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button size="sm" onClick={() => onApply(x.widgets, x.id)} data-testid="hb-tpl-use">
                  {t("hb.tpl.use")}
                </Button>
                {x.mine ? (
                  <Button size="sm" variant="outline" onClick={() => setSharing(x)} data-testid="hb-tpl-share">
                    <Share2 size={12} /> {t("hb.tpl.share")}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => copy(x)} data-testid="hb-tpl-copy">
                    <Copy size={12} /> {t("hb.tpl.copy")}
                  </Button>
                )}
                {x.canDelete && (
                  <button onClick={() => remove(x)} className="ml-auto text-neutral-400 hover:text-red-600" aria-label={t("common.delete")}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
      {sharing && <ShareDialog workspaceId={workspaceId} role={role} template={sharing} onClose={() => setSharing(null)} onSaved={load} />}
    </div>
  );
}

function useMembers(workspaceId: string) {
  const [members, setMembers] = useState<{ id: string; name: string; email?: string }[]>([]);
  useEffect(() => {
    api.get<{ id: string; name: string; email?: string }[]>(`/api/workspaces/${workspaceId}/members`).then(setMembers).catch(() => {});
  }, [workspaceId]);
  return members;
}

/** Visibility + people picker shared by "Save as template" and "Share". */
function VisibilityPicker({ workspaceId, role, visibility, setVisibility, people, setPeople, ownerId }: { workspaceId: string; role: string; visibility: TemplateDto["visibility"]; setVisibility: (v: TemplateDto["visibility"]) => void; people: string[]; setPeople: (p: string[]) => void; ownerId?: string }) {
  const { t } = useT();
  const members = useMembers(workspaceId);
  const [q, setQ] = useState("");
  const canPublish = ["owner", "admin", "editor"].includes(role);
  const shown = useMemo(() => members.filter((m) => m.id !== ownerId && (!q || m.name.toLowerCase().includes(q.toLowerCase()) || (m.email ?? "").toLowerCase().includes(q.toLowerCase()))), [members, q, ownerId]);
  return (
    <div className="space-y-2">
      {(["private", "shared", "workspace"] as const).map((v) => {
        const Icon = v === "workspace" ? Globe : v === "shared" ? Users : Lock;
        const disabled = v === "workspace" && !canPublish;
        return (
          <label key={v} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer", visibility === v ? "border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30" : "border-neutral-200 dark:border-neutral-800", disabled && "opacity-50 cursor-not-allowed")}>
            <input type="radio" name="tpl-vis" className="mt-1 accent-indigo-600" checked={visibility === v} disabled={disabled} onChange={() => setVisibility(v)} data-testid={`hb-vis-${v}`} />
            <span>
              <span className="text-sm font-medium flex items-center gap-1">
                <Icon size={13} /> {t(`hb.vis.${v}` as MessageKey)}
              </span>
              <span className="block text-xs text-neutral-500">{disabled ? t("hb.vis.workspaceLocked") : t(`hb.visd.${v}` as MessageKey)}</span>
            </span>
          </label>
        );
      })}
      {visibility === "shared" && (
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("hb.tpl.findPeople")} className="h-8" />
          <div className="mt-2 max-h-40 overflow-y-auto thin-scroll space-y-0.5">
            {shown.map((m) => (
              <label key={m.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-neutral-50 dark:hover:bg-neutral-800 text-sm">
                <input type="checkbox" className="accent-indigo-600" checked={people.includes(m.id)} onChange={() => setPeople(people.includes(m.id) ? people.filter((x) => x !== m.id) : [...people, m.id])} data-testid="hb-share-person" />
                <span className="truncate">{m.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SaveTemplateDialog({ workspaceId, role, widgets, onClose, onSaved }: { workspaceId: string; role: string; widgets: HomeWidget[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<TemplateDto["visibility"]>("private");
  const [people, setPeople] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api.post(`/api/workspaces/${workspaceId}/home-templates`, { name, description: description || null, widgets, visibility, shareWith: people });
      toast.success(t("hb.tpl.saved"));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{t("hb.saveTemplate")}</DialogTitle>
        <div className="mt-3 space-y-3" data-testid="hb-tpl-dialog">
          <LayoutThumb widgets={widgets} />
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {t("hb.tpl.name")}
            <Input className="mt-1" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={t("hb.tpl.namePh")} data-testid="hb-tpl-name" />
          </label>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {t("hb.tpl.description")}
            <Textarea className="mt-1" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <VisibilityPicker workspaceId={workspaceId} role={role} visibility={visibility} setVisibility={setVisibility} people={people} setPeople={setPeople} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={busy || !name.trim() || (visibility === "shared" && !people.length)} data-testid="hb-tpl-submit">
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShareDialog({ workspaceId, role, template, onClose, onSaved }: { workspaceId: string; role: string; template: TemplateDto; onClose: () => void; onSaved: () => void }) {
  const { t } = useT();
  const [visibility, setVisibility] = useState(template.visibility);
  const [people, setPeople] = useState(template.sharedWith.map((x) => x.id));
  async function submit() {
    try {
      await api.patch(`/api/home-templates/${template.id}`, { visibility, shareWith: people });
      toast.success(t("hb.tpl.shareSaved"));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{t("hb.tpl.shareTitle", { name: template.name })}</DialogTitle>
        <div className="mt-3">
          <VisibilityPicker workspaceId={workspaceId} role={role} visibility={visibility} setVisibility={setVisibility} people={people} setPeople={setPeople} ownerId={template.owner.id} />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={visibility === "shared" && !people.length} data-testid="hb-share-submit">
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
