"use client";
import { useMemo, useState } from "react";
import { FileDown, FileText, Library, Loader2, Save, Sparkles, Trash2, ArrowLeft, Check } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CharCount } from "@/components/ui/char-count";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import { REPORT_CHARTS_TOTAL_MAX, REPORT_FILENAME_MAX, REPORT_PROMPT_MAX } from "@/lib/ai/report-limits";
import { buildReportHtml, printReportHtml, type ReportChart } from "./print-report";

type Header = { workspace: string; logoUrl: string | null; author: string };
type Draft = { title: string; fileName: string; markdown: string; charts: ReportChart[]; header: Header; prompt: string; date?: Date };

/**
 * Snapshot the charts on screen for a report. Chart containers carry
 * data-report-chart / data-chart-id / data-chart-title; we keep the chart SVG
 * (plus its legend), a KPI's number, or a pivot table.
 */
export function captureCharts(root: HTMLElement | null): ReportChart[] {
  if (!root) return [];
  const out: ReportChart[] = [];
  root.querySelectorAll<HTMLElement>("[data-report-chart]").forEach((el) => {
    const id = el.dataset.chartId;
    if (!id) return;
    const title = el.dataset.chartTitle ?? "";
    let svg = "";
    const kpi = el.querySelector<HTMLElement>('[data-testid="report-kpi"], [data-testid="kpi-value"]');
    // Legend swatches are small svg.recharts-surface too: take the largest chart surface outside the legend.
    const chart =
      [...el.querySelectorAll<SVGSVGElement>("svg.recharts-surface")]
        .filter((s) => !s.closest(".recharts-legend-wrapper"))
        .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] ?? null;
    const table = el.querySelector("table");
    const narrative = el.querySelector<HTMLElement>("[data-narrative]");
    if (narrative) svg = `<div class="narrative">${narrative.innerHTML}</div>`;
    else if (chart) {
      const clone = chart.cloneNode(true) as SVGSVGElement;
      if (!clone.getAttribute("viewBox")) {
        const w = Number(chart.getAttribute("width")) || chart.clientWidth;
        const h = Number(chart.getAttribute("height")) || chart.clientHeight;
        if (w && h) clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
      }
      const legend = el.querySelector(".recharts-legend-wrapper ul");
      svg = clone.outerHTML + (legend ? legend.outerHTML : "");
    } else if (kpi) {
      // Dashboard KPIs also show a label and a trend: keep them as separate lines, not one run-on string.
      const num = kpi.querySelector("[data-kpi-number]") ?? kpi;
      const sub = [kpi.querySelector("[data-kpi-label]"), kpi.querySelector("[data-kpi-trend]")].map((x) => x?.textContent?.replace(/\s+/g, " ").trim()).filter(Boolean).join(" · ");
      svg = `<div class="kpi">${escapeText(num.textContent?.trim() ?? "")}</div>${sub ? `<div class="kpi-sub">${escapeText(sub)}</div>` : ""}`;
    }
    else if (table) svg = table.outerHTML;
    if (svg && svg.length <= 400_000) out.push({ id, title, svg });
  });
  return out.slice(0, 30);
}

function escapeText(s: string) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

/** Sandboxed preview of the printable report. */
function ReportPreview({ html }: { html: string }) {
  return <iframe title="report-preview" srcDoc={html} sandbox="allow-same-origin" className="w-full h-[60vh] rounded-md border border-neutral-200 dark:border-neutral-700 bg-white" data-testid="report-preview" />;
}

function ReportActions({ draft, saved, onSave, saving }: { draft: Draft; saved: boolean; onSave?: () => void; saving?: boolean }) {
  const { t, locale } = useT();
  const download = () => printReportHtml(buildReportHtml({ ...draft, title: draft.fileName || draft.title, workspace: draft.header.workspace, author: draft.header.author, logoUrl: draft.header.logoUrl ? new URL(draft.header.logoUrl, window.location.origin).href : null, locale }));
  return (
    <>
      <Button variant="secondary" onClick={download} data-testid="report-download">
        <FileDown size={13} /> {t("rep.download")}
      </Button>
      {onSave && (
        <Button onClick={onSave} disabled={saved || saving} data-testid="report-save-library">
          {saving ? <Loader2 size={13} className="animate-spin" /> : saved ? <Check size={13} /> : <Save size={13} />} {saved ? t("rep.saved") : t("rep.save")}
        </Button>
      )}
    </>
  );
}

/**
 * "AI PDF report": AI asks how the report should look; the user answers
 * (goal, visuals, analysis, file name); AI writes it with the live charts;
 * the user previews, downloads it as PDF and/or saves it to their library.
 */
export function AiReportButton({
  workspaceId,
  targetKind,
  targetId,
  getData,
  getCharts,
}: {
  workspaceId: string;
  targetKind: "project" | "dashboard";
  targetId: string;
  getData: () => string;
  getCharts: () => ReportChart[];
}) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const examples = [t("rep.ex1"), t("rep.ex2"), t("rep.ex3"), t("rep.ex4")];
  const html = useMemo(() => (draft ? buildReportHtml({ ...draft, workspace: draft.header.workspace, author: draft.header.author, logoUrl: draft.header.logoUrl, locale }) : ""), [draft, locale]);

  async function generate() {
    if (prompt.trim().length < 3) return;
    setBusy(true);
    try {
      const charts = getCharts();
      const r = await api.post<{ title: string; fileName: string; markdown: string; header: Header }>("/api/ai/report", {
        targetKind,
        targetId,
        prompt: prompt.trim(),
        fileName: fileName.trim() || undefined,
        data: getData().slice(0, 60_000),
        charts: charts.map((c) => ({ id: c.id, title: c.title })),
      });
      setDraft({ ...r, charts, prompt: prompt.trim() });
      setSaved(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      // Only keep the charts the report actually shows.
      // Only keep the charts the report shows, within the total size a saved report may carry.
      let total = 0;
      const used = draft.charts.filter((c) => draft.markdown.includes(`[[chart:${c.id}]]`) && (total += c.svg.length) <= REPORT_CHARTS_TOTAL_MAX);
      await api.post(`/api/workspaces/${workspaceId}/saved-reports`, {
        title: draft.title,
        fileName: draft.fileName,
        prompt: draft.prompt,
        content: draft.markdown,
        charts: used,
        ...(targetKind === "project" ? { projectId: targetId } : { dashboardId: targetId }),
      });
      setSaved(true);
      toast.success(t("rep.savedToast"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="ai-report">
        <FileText size={13} className="text-indigo-500" /> {t("rep.button")}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className={cn(draft ? "max-w-4xl" : "max-w-xl")}>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={15} className="text-indigo-500" /> {draft ? draft.title : t("rep.title")}
          </DialogTitle>
          {!draft ? (
            <>
              <div className="mt-3 flex gap-2.5">
                <span className="h-7 w-7 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 flex items-center justify-center shrink-0">
                  <Sparkles size={13} />
                </span>
                <div className="rounded-2xl rounded-tl-md bg-neutral-100 dark:bg-neutral-800 px-3.5 py-2.5 text-sm text-neutral-700 dark:text-neutral-200 whitespace-pre-line" data-testid="report-ai-question">
                  {t("rep.question")}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {examples.map((ex) => (
                  <button key={ex} onClick={() => setPrompt(ex)} title={ex} className="max-w-full truncate text-[11px] rounded-full border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-neutral-600 dark:text-neutral-300 hover:border-indigo-400">
                    {ex}
                  </button>
                ))}
              </div>
              <textarea
                autoFocus
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && generate()}
                rows={5}
                maxLength={REPORT_PROMPT_MAX}
                placeholder={t("rep.placeholder")}
                data-testid="report-prompt"
                className="mt-3 w-full max-h-[40vh] rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-indigo-400"
              />
              <CharCount value={prompt} max={REPORT_PROMPT_MAX} />
              <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mt-3">{t("rep.fileName")}</label>
              <Input value={fileName} onChange={(e) => setFileName(e.target.value)} maxLength={REPORT_FILENAME_MAX} placeholder={t("rep.fileNamePh")} className="mt-1" data-testid="report-filename" />
              <CharCount value={fileName} max={REPORT_FILENAME_MAX} />
              <div className="flex items-center justify-end gap-2 mt-4">
                {busy && <span className="mr-auto text-xs text-neutral-500">{t("rep.wait")}</span>}
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                  {t("common.cancel")}
                </Button>
                <Button onClick={generate} disabled={busy || prompt.trim().length < 3} data-testid="report-generate">
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {t("rep.generate")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-neutral-500 mt-1">
                {t("rep.fileLabel")}: <span className="font-medium text-neutral-700 dark:text-neutral-200">{draft.fileName}.pdf</span>
              </p>
              <div className="mt-3">
                <ReportPreview html={html} />
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 mt-4">
                <Button variant="ghost" className="mr-auto" onClick={() => setDraft(null)} data-testid="report-back">
                  <ArrowLeft size={13} /> {t("rep.edit")}
                </Button>
                <ReportActions draft={draft} saved={saved} saving={saving} onSave={save} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

type LibraryRow = { id: string; title: string; fileName: string; prompt: string; createdAt: string; source: string | null };

/** My saved AI reports: open, download again, delete. */
export function ReportLibraryButton({ workspaceId, projectId, dashboardId, size = "sm" }: { workspaceId: string; projectId?: string; dashboardId?: string; size?: "sm" | "md" }) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const [onlyHere, setOnlyHere] = useState(!!(projectId || dashboardId));
  const [rows, setRows] = useState<LibraryRow[] | null>(null);
  const [viewing, setViewing] = useState<Draft | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  function load(here: boolean) {
    const q = here ? (projectId ? `?projectId=${projectId}` : dashboardId ? `?dashboardId=${dashboardId}` : "") : "";
    setRows(null);
    api.get<LibraryRow[]>(`/api/workspaces/${workspaceId}/saved-reports${q}`).then(setRows).catch(() => setRows([]));
  }

  async function openReport(id: string) {
    setLoadingId(id);
    try {
      const r = await api.get<{ title: string; fileName: string; content: string; charts: ReportChart[]; prompt: string; createdAt: string; header: Header }>(`/api/saved-reports/${id}`);
      setViewing({ title: r.title, fileName: r.fileName, markdown: r.content, charts: r.charts, prompt: r.prompt, header: r.header, date: new Date(r.createdAt) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setLoadingId(null);
    }
  }

  async function remove(id: string) {
    if (!confirm(t("rep.deleteConfirm"))) return;
    try {
      await api.delete(`/api/saved-reports/${id}`);
      setRows((prev) => prev?.filter((r) => r.id !== id) ?? null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  const html = viewing ? buildReportHtml({ ...viewing, workspace: viewing.header.workspace, author: viewing.header.author, logoUrl: viewing.header.logoUrl, locale }) : "";

  return (
    <>
      <Button size={size === "sm" ? "sm" : undefined} variant="secondary" onClick={() => { setOpen(true); load(onlyHere); }} data-testid="report-library">
        <Library size={13} /> {t("rep.library")}
      </Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setViewing(null); }}>
        <DialogContent className={cn(viewing ? "max-w-4xl" : "max-w-2xl")}>
          <DialogTitle className="flex items-center gap-2">
            <Library size={15} className="text-indigo-500" /> {viewing ? viewing.title : t("rep.library")}
          </DialogTitle>
          {viewing ? (
            <>
              <div className="mt-3">
                <ReportPreview html={html} />
              </div>
              <div className="flex items-center justify-end gap-2 mt-4">
                <Button variant="ghost" className="mr-auto" onClick={() => setViewing(null)}>
                  <ArrowLeft size={13} /> {t("rep.backToLibrary")}
                </Button>
                <ReportActions draft={viewing} saved />
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-neutral-500 mt-1">{t("rep.libraryHint")}</p>
              {(projectId || dashboardId) && (
                <label className="mt-3 inline-flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                  <input type="checkbox" checked={onlyHere} onChange={(e) => { setOnlyHere(e.target.checked); load(e.target.checked); }} data-testid="report-library-only-here" /> {t("rep.onlyHere")}
                </label>
              )}
              <div className="mt-3 max-h-[55vh] overflow-y-auto thin-scroll divide-y divide-neutral-100 dark:divide-neutral-800 rounded-md border border-neutral-200 dark:border-neutral-800">
                {rows === null && <div className="p-6 text-center text-sm text-neutral-400">{t("common.loading")}</div>}
                {rows?.length === 0 && <div className="p-6 text-center text-sm text-neutral-400" data-testid="report-library-empty">{t("rep.libraryEmpty")}</div>}
                {rows?.map((r) => (
                  <div key={r.id} className="flex items-center gap-3 px-3 py-2.5" data-testid="report-library-row">
                    <FileText size={16} className="text-indigo-500 shrink-0" />
                    <button className="min-w-0 flex-1 text-left" onClick={() => openReport(r.id)}>
                      <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate">{r.title}</div>
                      <div className="text-[11px] text-neutral-500 truncate">
                        {r.fileName}.pdf · {formatDate(r.createdAt)}
                        {r.source ? ` · ${r.source}` : ""}
                      </div>
                    </button>
                    {loadingId === r.id ? <Loader2 size={14} className="animate-spin text-neutral-400" /> : null}
                    <button onClick={() => openReport(r.id)} className="text-xs text-indigo-600 hover:underline shrink-0">
                      {t("common.open")}
                    </button>
                    <button onClick={() => remove(r.id)} className="p-1 rounded text-neutral-400 hover:text-red-600" aria-label={t("common.delete")}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
