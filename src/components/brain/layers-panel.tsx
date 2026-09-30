"use client";
// Progressive summarization: Source (the page, never modified) -> Highlights
// -> Key points -> Summary -> Key insights. AI proposes the upper layers as a
// draft; an editor saves or edits them.
import { useEffect, useState } from "react";
import { Layers, Loader2, Sparkles, Trash2, AlertTriangle, Check } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn, formatDate } from "@/lib/utils";
import { Markdown } from "@/components/ai/markdown";
import type { MessageKey } from "@/lib/i18n/core";
import { Meta } from "@/components/ui/meta";

export interface LayerState {
  highlights: { id: string; text: string; blockId?: string; by?: string; at: string }[];
  keyPoints: string | null;
  summary: string | null;
  insights: string | null;
  generatedAt: string | null;
  stale: boolean;
}
type Field = "keyPoints" | "summary" | "insights";
const TABS = ["highlights", "keyPoints", "summary", "insights"] as const;

export function LayersPanel({ pageId, canEdit, refreshKey, onJumpToBlock }: { pageId: string; canEdit: boolean; refreshKey: number; onJumpToBlock: (blockId: string) => void }) {
  const { t } = useT();
  const [state, setState] = useState<LayerState | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("highlights");
  const [draft, setDraft] = useState<(Record<Field, string> & { generatedFrom: string }) | null>(null);
  const [editing, setEditing] = useState<Field | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<LayerState>(`/api/wiki/${pageId}/layers`).then(setState).catch(() => {});
  }, [pageId, refreshKey]);

  async function put(body: Record<string, unknown>) {
    try {
      setState(await api.put<LayerState>(`/api/wiki/${pageId}/layers`, body));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }
  async function generate() {
    setBusy(true);
    try {
      setDraft(await api.post<Record<Field, string> & { generatedFrom: string }>(`/api/wiki/${pageId}/layers/generate`));
      setTab("keyPoints");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }
  async function saveDraft() {
    if (!draft) return;
    await put({ keyPoints: draft.keyPoints || null, summary: draft.summary || null, insights: draft.insights || null, generatedFrom: draft.generatedFrom });
    setDraft(null);
    toast.success(t("brain.layers.saved"));
  }

  if (!state) return null;
  const count = (k: (typeof TABS)[number]) => (k === "highlights" ? state.highlights.length : state[k] ? 1 : 0);
  return (
    <section className="mt-6 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900" data-testid="layers-panel">
      <div className="flex items-center gap-2 px-3 pt-2.5">
        <Layers size={14} className="text-indigo-600" />
        <h3 className="text-sm font-semibold">{t("brain.layers.title")}</h3>
        <span className="text-[11px] text-neutral-400 hidden sm:inline">{t("brain.layers.hint")}</span>
        {canEdit && (
          <Button size="sm" variant="outline" className="ml-auto" onClick={generate} disabled={busy} data-testid="layers-generate">
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {t("brain.layers.generate")}
          </Button>
        )}
      </div>
      {state.stale && !draft && (
        <p className="mx-3 mt-2 flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          <AlertTriangle size={12} /> {t("brain.layers.stale")}
        </p>
      )}
      <div className="flex items-center gap-1 border-b border-neutral-200 dark:border-neutral-800 px-2 mt-1 overflow-x-auto thin-scroll">
        <span className="h-8 px-2 text-xs inline-flex items-center text-neutral-400 whitespace-nowrap">{t("brain.layers.source")} →</span>
        {TABS.map((k, i) => (
          <button key={k} onClick={() => setTab(k)} className={cn("h-8 px-2 text-xs font-medium inline-flex items-center gap-1 border-b-2 -mb-px whitespace-nowrap", tab === k ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-neutral-500")} data-testid={`layer-tab-${k}`}>
            {i + 1}. {t(`brain.layers.${k}` as MessageKey)}
            <span className="text-neutral-400 tabular-nums">{draft && k !== "highlights" && draft[k as Field] ? "•" : count(k)}</span>
          </button>
        ))}
      </div>
      <div className="p-3 text-sm">
        {tab === "highlights" ? (
          state.highlights.length ? (
            <ul className="space-y-1.5">
              {state.highlights.map((h) => (
                <li key={h.id} className="group flex items-start gap-2" data-testid="layer-highlight">
                  <span className="mt-1 h-3 w-1 rounded bg-yellow-400 shrink-0" />
                  <button onClick={() => h.blockId && onJumpToBlock(h.blockId)} className={cn("text-left flex-1", h.blockId && "hover:underline")}>
                    {h.text}
                  </button>
                  <Meta className="text-[10px] text-neutral-400 shrink-0 gap-x-2"><span>{h.by}</span><span>{formatDate(h.at)}</span></Meta>
                  {canEdit && (
                    <button onClick={() => put({ removeHighlight: h.id })} className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-600" aria-label={t("common.delete")}>
                      <Trash2 size={12} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-neutral-500">{t("brain.layers.noHighlights")}</p>
          )
        ) : draft ? (
          <div className="space-y-2">
            <p className="text-[11px] text-purple-700 dark:text-purple-300">{t("brain.layers.draftNote")}</p>
            <Textarea rows={8} value={draft[tab as Field]} onChange={(e) => setDraft({ ...draft, [tab]: e.target.value })} data-testid="layer-draft" />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveDraft} data-testid="layers-save-draft">
                <Check size={12} /> {t("brain.layers.saveDraft")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : editing === tab ? (
          <div className="space-y-2">
            <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  await put({ [tab]: text.trim() || null });
                  setEditing(null);
                }}
              >
                {t("common.save")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            {state[tab as Field] ? <Markdown text={state[tab as Field]!} /> : <p className="text-xs text-neutral-500">{t("brain.layers.empty")}</p>}
            {canEdit && (
              <button
                onClick={() => {
                  setText(state[tab as Field] ?? "");
                  setEditing(tab as Field);
                }}
                className="mt-2 text-xs text-indigo-600 hover:underline"
              >
                {t("common.edit")}
              </button>
            )}
            {state.generatedAt && <p className="mt-1 text-[10px] text-neutral-400">{t("brain.layers.generatedAt", { date: formatDate(state.generatedAt, true) })}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
