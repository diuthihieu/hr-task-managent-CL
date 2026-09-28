"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import RGL, { WidthProvider, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { ChevronRight, Plus, X, LayoutDashboard, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { WidgetCard, type DashboardBlockLite, type DataResponse } from "./widget-card";
import { AiDashboardActions, AiBuildWidgetsButton } from "@/components/ai/ai-actions";
import { WidgetEditorDialog, type BlockDraft } from "./widget-editor-dialog";
import { DashboardFilterBar } from "./filter-bar";
import type { CrossFilter, SeriesPoint } from "@/lib/dashboard-engine";
import { parseBlockConfig } from "@/lib/dashboard-engine";
import type { FieldRow } from "@/types";
import { useT } from "@/components/i18n-provider";

const GridLayout = WidthProvider(RGL);

interface DashboardDetail {
  id: string;
  name: string;
  filters: string;
  blocks: (DashboardBlockLite & { x: number; y: number; w: number; h: number })[];
  projects: { id: string; name: string }[];
}

type Slicer = CrossFilter & { id: string };

export function DashboardWorkspace({
  dashboardId,
  workspaceSlug,
  breadcrumb,
}: {
  dashboardId: string;
  workspaceSlug: string;
  breadcrumb: { workspace: string; dashboard: string };
}) {
  const { t } = useT();
  const router = useRouter();
  const [dashboard, setDashboard] = useState<DashboardDetail | null>(null);
  const [allFields, setAllFields] = useState<FieldRow[]>([]);
  const [slicers, setSlicers] = useState<Slicer[]>([]);
  const [crossFilter, setCrossFilter] = useState<{ sourceBlockId: string; filter: CrossFilter } | null>(null);
  const [widgetDialog, setWidgetDialog] = useState<{ open: boolean; block: (DashboardBlockLite & { x: number; y: number; w: number; h: number }) | null }>({
    open: false,
    block: null,
  });
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const widgetData = useRef(new Map<string, DataResponse>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await api.get<DashboardDetail>(`/api/dashboards/${dashboardId}`);
      setDashboard(detail);
      const filters = JSON.parse(detail.filters || "{}") as { slicers?: Slicer[] };
      setSlicers(filters.slicers ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setLoading(false);
    }
  }, [dashboardId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching dashboard data on mount is exactly what this effect is for
    load();
  }, [load]);

  // Fetch every field across every table in the base once, purely to resolve
  // field ids -> names for widget titles and to seed the cross-filter
  // mechanism (see dashboard-engine.ts). Never used to duplicate record data.
  useEffect(() => {
    if (!dashboard) return;
    let cancelled = false;
    Promise.all(dashboard.projects.map((p) => api.get<{ fields: FieldRow[] }>(`/api/projects/${p.id}`).catch(() => ({ fields: [] }))))
      .then((results) => {
        if (!cancelled) setAllFields(results.flatMap((r) => r.fields));
      });
    return () => {
      cancelled = true;
    };
  }, [dashboard]);

  const fieldNameLookup = useCallback((fieldId: string | undefined) => allFields.find((f) => f.id === fieldId)?.name, [allFields]);
  const fieldNames = useMemo(() => [...new Set(allFields.map((f) => f.name))].sort(), [allFields]);

  function persistSlicers(next: Slicer[]) {
    setSlicers(next);
    api.patch(`/api/dashboards/${dashboardId}`, { filters: { slicers: next } }).catch(() => toast.error(t("common.failed")));
  }

  async function renameDashboard() {
    if (!nameDraft.trim() || !dashboard) return setRenaming(false);
    setDashboard({ ...dashboard, name: nameDraft.trim() });
    setRenaming(false);
    try {
      await api.patch(`/api/dashboards/${dashboardId}`, { name: nameDraft.trim() });
    } catch {
      toast.error(t("common.failed"));
    }
  }

  async function deleteDashboard() {
    if (!dashboard || !confirm(t("db.deleteConfirm", { name: dashboard.name }))) return;
    try {
      await api.delete(`/api/dashboards/${dashboardId}`);
      router.push(`/w/${workspaceSlug}/dashboards`);
      router.refresh();
      router.refresh();
    } catch {
      toast.error(t("common.failed"));
    }
  }

  async function addWidget() {
    setWidgetDialog({ open: true, block: null });
  }

  async function saveWidget(draft: BlockDraft) {
    if (!dashboard) return;
    try {
      if (widgetDialog.block) {
        const updated = await api.patch<DashboardBlockLite>(`/api/dashboard-blocks/${widgetDialog.block.id}`, {
          type: draft.type,
          title: draft.title,
          config: draft.config,
        });
        setDashboard((d) => (d ? { ...d, blocks: d.blocks.map((b) => (b.id === updated.id ? { ...b, ...updated } : b)) } : d));
      } else {
        const created = await api.post<DashboardBlockLite & { x: number; y: number; w: number; h: number }>(`/api/dashboards/${dashboardId}/blocks`, {
          type: draft.type,
          title: draft.title,
          config: draft.config,
        });
        setDashboard((d) => (d ? { ...d, blocks: [...d.blocks, created] } : d));
      }
      setWidgetDialog({ open: false, block: null });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function deleteWidget(blockId: string) {
    if (!confirm(t("db.deleteWidgetConfirm"))) return;
    setDashboard((d) => (d ? { ...d, blocks: d.blocks.filter((b) => b.id !== blockId) } : d));
    try {
      await api.delete(`/api/dashboard-blocks/${blockId}`);
    } catch {
      toast.error(t("common.failed"));
      load();
    }
  }

  function handleLayoutChange(layout: Layout[]) {
    if (!dashboard) return;
    setDashboard((d) => (d ? { ...d, blocks: d.blocks.map((b) => {
      const l = layout.find((li) => li.i === b.id);
      return l ? { ...b, x: l.x, y: l.y, w: l.w, h: l.h } : b;
    }) } : d));
  }

  function persistLayout(layout: Layout[]) {
    for (const l of layout) {
      api.patch(`/api/dashboard-blocks/${l.i}`, { x: l.x, y: l.y, w: l.w, h: l.h }).catch(() => {});
    }
  }

  function handleCrossFilterClick(block: DashboardBlockLite, point: SeriesPoint) {
    const config = parseBlockConfig(block.config);
    const fieldName = fieldNameLookup(config.dimensionFieldId);
    if (!fieldName) return;
    if (crossFilter?.sourceBlockId === block.id && crossFilter.filter.label === point.label) {
      setCrossFilter(null); // clicking the same segment again clears it
      return;
    }
    setCrossFilter({ sourceBlockId: block.id, filter: { fieldName, label: point.label } });
  }

  /** Compact text snapshot of what every widget currently shows, for AI Insight. */
  function snapshot(): string {
    if (!dashboard) return "";
    const lines: string[] = [`Dashboard: ${dashboard.name}`];
    if (slicers.length) lines.push(`Filters: ${slicers.map((s) => `${s.fieldName}=${s.label}`).join(", ")}`);
    if (crossFilter) lines.push(`Cross-filter: ${crossFilter.filter.fieldName}=${crossFilter.filter.label}`);
    for (const b of dashboard.blocks) {
      const d = widgetData.current.get(b.id);
      lines.push(`\n## ${b.title || "Untitled"} (${b.type})`);
      if (!d) lines.push("(not loaded)");
      else if (d.error) lines.push(`(error: ${d.error})`);
      else if (d.kpi !== undefined) lines.push(`Value: ${d.kpi}`);
      else if (d.series) lines.push(d.series.slice(0, 60).map((p) => `${p.label}: ${p.value}${p.value2 !== undefined ? ` / ${p.value2}` : ""}`).join("\n"));
      else if (d.columns) lines.push([d.columns.join(" | "), ...(d.rows ?? []).slice(0, 40).map((r) => r.join(" | "))].join("\n"));
      else lines.push(JSON.stringify(d).slice(0, 3000));
    }
    return lines.join("\n");
  }

  if (loading && !dashboard) {
    return <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm">{t("db.loading")}</div>;
  }
  if (!dashboard) return null;

  const layout: Layout[] = dashboard.blocks.map((b) => ({ i: b.id, x: b.x, y: b.y, w: b.w, h: b.h, minW: 2, minH: 2 }));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-1.5 h-12 px-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0 text-sm">
        <span className="text-neutral-400">{breadcrumb.workspace}</span>
        <ChevronRight size={13} className="text-neutral-300" />
        <LayoutDashboard size={14} className="text-indigo-500" />
        {renaming ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={renameDashboard}
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            className="h-7 text-sm rounded-md border border-indigo-400 px-1.5 bg-white dark:bg-neutral-900"
          />
        ) : (
          <span
            className="font-medium text-neutral-800 dark:text-neutral-100 cursor-text"
            onDoubleClick={() => {
              setNameDraft(dashboard.name);
              setRenaming(true);
            }}
          >
            {dashboard.name}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {dashboard.blocks.length > 0 && <AiDashboardActions dashboardId={dashboardId} getData={snapshot} />}
          <AiBuildWidgetsButton target="dashboard" dashboardId={dashboardId} onBuilt={() => load()} />
          <Button size="sm" onClick={addWidget}>
            <Plus size={13} /> {t("db.addWidget")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <Pencil size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onSelect={() => {
                  setNameDraft(dashboard.name);
                  setRenaming(true);
                }}
              >
                <Pencil size={13} /> {t("db.rename")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={deleteDashboard} className="text-red-600 dark:text-red-400">
                <Trash2 size={13} /> {t("db.delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 px-4 h-10 border-b border-neutral-100 dark:border-neutral-900 shrink-0 overflow-x-auto thin-scroll">
        <DashboardFilterBar fieldNames={fieldNames} slicers={slicers} onChange={persistSlicers} />
        {crossFilter && (
          <button
            onClick={() => setCrossFilter(null)}
            className="flex items-center gap-1 text-xs bg-indigo-600 text-white rounded-full px-2.5 py-1 shrink-0"
          >
            Cross-filter: {crossFilter.filter.fieldName} = {crossFilter.filter.label}
            <X size={11} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll p-3">
        {dashboard.blocks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-neutral-400 gap-2">
            <LayoutDashboard size={32} className="opacity-40" />
            <p>{t("db.noWidgets")}</p>
            <Button onClick={addWidget}>
              <Plus size={14} /> {t("db.firstWidget")}
            </Button>
          </div>
        ) : (
          <GridLayout
            className="layout"
            layout={layout}
            cols={12}
            rowHeight={32}
            margin={[10, 10]}
            draggableHandle=".drag-handle"
            onLayoutChange={handleLayoutChange}
            onDragStop={(l) => persistLayout(l)}
            onResizeStop={(l) => persistLayout(l)}
          >
            {dashboard.blocks.map((block) => (
              <div key={block.id}>
                <WidgetCard
                  block={block}
                  slicers={slicers}
                  crossFilter={crossFilter?.filter ?? null}
                  fieldNameLookup={fieldNameLookup}
                  onEdit={() => setWidgetDialog({ open: true, block })}
                  onDelete={() => deleteWidget(block.id)}
                  onCrossFilter={(point) => handleCrossFilterClick(block, point)}
                  crossFilterActive={crossFilter?.sourceBlockId === block.id ? crossFilter.filter.label : null}
                  onData={(d) => widgetData.current.set(block.id, d)}
                />
              </div>
            ))}
          </GridLayout>
        )}
      </div>

      <WidgetEditorDialog
        open={widgetDialog.open}
        onOpenChange={(v) => setWidgetDialog((d) => ({ ...d, open: v }))}
        projects={dashboard.projects}
        initial={widgetDialog.block ? { type: widgetDialog.block.type as BlockDraft["type"], title: widgetDialog.block.title, config: parseBlockConfig(widgetDialog.block.config) } : null}
        onSave={saveWidget}
      />
    </div>
  );
}
