"use client";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchList, type SearchItem } from "@/components/ui/search-list";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";
import { DEFAULT_EXPORT_COLUMNS, EXPORT_COLUMNS, type ExportColumn } from "@/lib/my-export-format";

interface Options {
  me: string;
  workspaces: { id: string; name: string }[];
  projects: { id: string; name: string; workspaceId: string }[];
  people: { id: string; name: string; email: string; workspaceIds: string[] }[];
  statuses: string[];
}
type Range = { from: string | null; to: string | null };
interface Filters {
  workspaceIds: string[];
  projectIds: string[];
  assigneeIds: string[];
  reporterIds: string[];
  statuses: string[];
  startDate: Range;
  dueDate: Range;
  completedAt: Range;
}
interface Preview {
  count: number;
  tooMany: boolean;
  max: number;
  actualHours: number;
  workspaces: number;
}

const EMPTY: Range = { from: null, to: null };
const initialFilters = (me: string): Filters => ({ workspaceIds: [], projectIds: [], assigneeIds: me ? [me] : [], reporterIds: [], statuses: [], startDate: EMPTY, dueDate: EMPTY, completedAt: EMPTY });

/** Multi-select with search: the button shows "All" or how many are picked. */
function MultiPick({ label, items, value, onChange, testId }: { label: string; items: SearchItem[]; value: string[]; onChange: (v: string[]) => void; testId: string }) {
  const { t } = useT();
  const shown = value.length === 0 ? t("mx.all") : value.length === 1 ? (items.find((i) => i.value === value[0])?.label ?? t("mx.selected", { count: 1 })) : t("mx.selected", { count: value.length });
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-neutral-500">{label}</div>
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="flex h-8 w-full items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-2 text-left text-xs text-neutral-700 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200" data-testid={testId}>
            <span className="truncate">{shown}</span>
            <ChevronDown size={13} className="shrink-0 text-neutral-400" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(22rem,calc(100vw-24px))] p-1.5 pt-2">
          {value.length > 0 && (
            <button type="button" onClick={() => onChange([])} className="mb-1 w-full rounded px-2 py-1 text-left text-xs text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950" data-testid={`${testId}-clear`}>
              {t("mx.all")}
            </button>
          )}
          <SearchList items={items} selected={value} placeholder={t("mx.search")} testId={testId} onPick={(v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function RangePick({ label, value, onChange, testId }: { label: string; value: Range; onChange: (v: Range) => void; testId: string }) {
  const { t } = useT();
  const cls = "h-8 w-full min-w-0 rounded-md border border-neutral-200 bg-white px-2 text-xs dark:border-neutral-800 dark:bg-neutral-900";
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-neutral-500">{label}</div>
      {/* One range (from - to), not two separate fields. */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-1.5">
        <label className="min-w-0 space-y-0.5">
          <span className="block text-[10px] text-neutral-400">{t("mx.from")}</span>
          <DateInput value={value.from} onCommit={(from) => onChange({ ...value, from })} className={cls} aria-label={`${label} ${t("mx.from")}`} data-testid={`${testId}-from`} />
        </label>
        <span className="pb-1.5 text-xs text-neutral-400" aria-hidden>-</span>
        <label className="min-w-0 space-y-0.5">
          <span className="block text-[10px] text-neutral-400">{t("mx.to")}</span>
          <DateInput value={value.to} onCommit={(to) => onChange({ ...value, to })} className={cls} aria-label={`${label} ${t("mx.to")}`} data-testid={`${testId}-to`} />
        </label>
      </div>
    </div>
  );
}

/** "Export my data": tasks I can see in every workspace I belong to, filtered, as XLSX or CSV. */
export function MyExportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useT();
  const [opts, setOpts] = useState<Options | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters(""));
  const [columns, setColumns] = useState<ExportColumn[]>(DEFAULT_EXPORT_COLUMNS);
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || opts) return;
    api
      .get<Options>("/api/account/export")
      .then((o) => {
        setOpts(o);
        setFilters(initialFilters(o.me));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : t("common.failed")));
  }, [open, opts, t]);

  const payloadFilters = useMemo(() => {
    const r = (x: Range) => (x.from || x.to ? x : undefined);
    return { ...filters, startDate: r(filters.startDate), dueDate: r(filters.dueDate), completedAt: r(filters.completedAt) };
  }, [filters]);

  useEffect(() => {
    if (!open || !opts) return;
    let live = true;
    const timer = setTimeout(() => {
      api
        .post<Preview>("/api/account/export", { filters: payloadFilters, preview: true })
        .then((p) => live && setPreview(p))
        .catch(() => live && setPreview(null));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [open, opts, payloadFilters]);

  const wsItems = (opts?.workspaces ?? []).map((w) => ({ value: w.id, label: w.name }));
  const inWs = (ids: string[]) => (filters.workspaceIds.length ? ids.some((id) => filters.workspaceIds.includes(id)) : true);
  const wsName = new Map((opts?.workspaces ?? []).map((w) => [w.id, w.name]));
  const projectItems = (opts?.projects ?? []).filter((p) => inWs([p.workspaceId])).map((p) => ({ value: p.id, label: (opts?.workspaces.length ?? 0) > 1 ? `${p.name} - ${wsName.get(p.workspaceId) ?? ""}` : p.name }));
  const peopleItems = (opts?.people ?? []).filter((p) => inWs(p.workspaceIds)).map((p) => ({ value: p.id, label: p.id === opts?.me ? `${p.name} (${t("mx.me")})` : `${p.name} - ${p.email}` }));
  const statusItems = (opts?.statuses ?? []).map((s) => ({ value: s, label: s }));
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));

  async function download() {
    if (!columns.length) return toast.error(t("mx.noColumns"));
    setBusy(true);
    try {
      const res = await fetch("/api/account/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filters: payloadFilters, columns, format }) });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string; count?: number; max?: number } | null;
        throw new Error(err?.error ?? (err?.count ? t("mx.tooMany", { count: err.count, max: err.max ?? 0 }) : t("common.failed")));
      }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? `woli-tasks.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(t("mx.downloaded", { count: Number(res.headers.get("x-export-count") ?? 0) }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" data-testid="my-export-dialog">
        <DialogTitle className="text-base font-semibold">{t("mx.title")}</DialogTitle>
        <p className="mt-1 text-xs text-neutral-500">{t("mx.desc")}</p>
        {!opts ? (
          <div className="py-8 text-center text-sm text-neutral-400">{t("common.loading")}</div>
        ) : (
          <div className="mt-4 space-y-4">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{t("mx.filters")}</h3>
                <button type="button" onClick={() => setFilters(initialFilters(opts.me))} className="flex items-center gap-1 text-xs text-neutral-500 hover:text-indigo-600" data-testid="mx-reset">
                  <RotateCcw size={12} /> {t("mx.reset")}
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <MultiPick label={t("mx.workspaces")} items={wsItems} value={filters.workspaceIds} onChange={(v) => set("workspaceIds", v)} testId="mx-ws" />
                <MultiPick label={t("mx.projects")} items={projectItems} value={filters.projectIds} onChange={(v) => set("projectIds", v)} testId="mx-projects" />
                <MultiPick label={t("mx.assignees")} items={peopleItems} value={filters.assigneeIds} onChange={(v) => set("assigneeIds", v)} testId="mx-assignees" />
                <MultiPick label={t("mx.reporters")} items={peopleItems} value={filters.reporterIds} onChange={(v) => set("reporterIds", v)} testId="mx-reporters" />
                <RangePick label={t("mx.startDate")} value={filters.startDate} onChange={(v) => set("startDate", v)} testId="mx-start" />
                <RangePick label={t("mx.completedAt")} value={filters.completedAt} onChange={(v) => set("completedAt", v)} testId="mx-completed" />
                <RangePick label={t("mx.dueDate")} value={filters.dueDate} onChange={(v) => set("dueDate", v)} testId="mx-due" />
                <MultiPick label={t("mx.statuses")} items={statusItems} value={filters.statuses} onChange={(v) => set("statuses", v)} testId="mx-statuses" />
              </div>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{t("mx.columns")}</h3>
                <div className="flex gap-3 text-xs">
                  <button type="button" className="text-indigo-600 hover:underline" onClick={() => setColumns([...EXPORT_COLUMNS])}>
                    {t("mx.colAll")}
                  </button>
                  <button type="button" className="text-neutral-500 hover:underline" onClick={() => setColumns(DEFAULT_EXPORT_COLUMNS)}>
                    {t("mx.colDefault")}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3" data-testid="mx-columns">
                {EXPORT_COLUMNS.map((c) => (
                  <label key={c} className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
                    <input type="checkbox" checked={columns.includes(c)} onChange={(e) => setColumns(e.target.checked ? EXPORT_COLUMNS.filter((x) => x === c || columns.includes(x)) : columns.filter((x) => x !== c))} data-testid={`mx-col-${c}`} />
                    {t(`mx.col.${c}` as MessageKey)}
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-neutral-400">{t("mx.hoursNote")}</p>
            </section>

            <section className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{t("mx.format")}</span>
              {(["xlsx", "csv"] as const).map((f) => (
                <label key={f} className="flex items-center gap-1.5 text-sm">
                  <input type="radio" name="mx-format" checked={format === f} onChange={() => setFormat(f)} data-testid={`mx-format-${f}`} />
                  {f === "xlsx" ? "Excel (.xlsx)" : "CSV"}
                </label>
              ))}
              {format === "xlsx" && <span className="text-[11px] text-neutral-400">{t("mx.xlsxHint")}</span>}
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <span className={preview?.tooMany ? "text-xs text-red-600" : "text-xs text-neutral-600 dark:text-neutral-300"} data-testid="mx-preview">
                {preview ? (preview.tooMany ? t("mx.tooMany", { count: preview.count, max: preview.max }) : t("mx.preview", { count: preview.count, hours: preview.actualHours, ws: preview.workspaces })) : "…"}
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={download} disabled={busy || !columns.length || !preview || preview.tooMany || preview.count === 0} data-testid="mx-download">
                  <Download size={14} /> {t("mx.download")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
