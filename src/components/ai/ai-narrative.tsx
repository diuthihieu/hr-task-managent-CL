"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { Markdown } from "./markdown";

// Same data → same narrative: don't call the AI again for numbers it already read
// (switching views, re-renders, a second widget with the same focus).
const cache = new Map<string, { text: string; at: string }>();

function hash(s: string) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * AI Narrative widget body: re-reads the dashboard whenever what it shows
 * changes (filters, edited tasks, added charts), debounced so a burst of
 * changes makes one request.
 */
export function AiNarrative({ targetKind, targetId, data, instruction }: { targetKind: "project" | "dashboard"; targetId: string; data: string; instruction?: string }) {
  const { t, locale } = useT();
  const key = `${targetKind}:${targetId}:${locale}:${hash(`${instruction ?? ""}\n${data}`)}`;
  const [state, setState] = useState<{ key: string; text: string; at: string } | null>(() => {
    const hit = cache.get(key);
    return hit ? { key, ...hit } : null;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const run = useCallback(
    async (force = false) => {
      const hit = cache.get(key);
      if (hit && !force) {
        setState({ key, ...hit });
        return;
      }
      const mine = ++seq.current;
      setBusy(true);
      setError(null);
      try {
        const r = await api.post<{ text: string; at: string }>("/api/ai/narrative", { targetKind, targetId, data: data.slice(0, 40_000), instruction: instruction ? String(instruction).slice(0, 500) : undefined });
        cache.set(key, r);
        if (mine === seq.current) setState({ key, ...r });
      } catch (e) {
        if (mine === seq.current) setError(e instanceof Error ? e.message : t("common.failed"));
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    },
    [key, targetKind, targetId, data, instruction, t]
  );

  useEffect(() => {
    if (!data.trim()) return;
    const timer = setTimeout(() => void run(), 1500);
    return () => clearTimeout(timer);
  }, [run, data]);

  const stale = state && state.key !== key;
  const time = state ? new Date(state.at).toLocaleTimeString(locale === "vi" ? "vi-VN" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="ai-narrative">
      <div className="flex-1 min-h-0 overflow-y-auto thin-scroll text-sm" data-narrative>
        {state ? (
          <Markdown text={state.text} className={stale ? "opacity-60" : undefined} />
        ) : busy ? (
          <p className="text-xs text-neutral-400 flex items-center gap-1.5 py-2">
            <Loader2 size={12} className="animate-spin" /> {t("narr.writing")}
          </p>
        ) : error ? null : (
          <p className="text-xs text-neutral-400 py-2">{t("narr.waiting")}</p>
        )}
        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-neutral-400 shrink-0">
        <Sparkles size={10} className="text-indigo-500" />
        <span className="truncate">{busy ? t("narr.updating") : time ? t("narr.updatedAt", { time }) : t("narr.live")}</span>
        <button type="button" onClick={() => void run(true)} disabled={busy} className="ml-auto p-0.5 rounded hover:text-indigo-600 disabled:opacity-40" title={t("narr.refresh")} aria-label={t("narr.refresh")} onMouseDown={(e) => e.stopPropagation()} data-testid="ai-narrative-refresh">
          {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
        </button>
      </div>
    </div>
  );
}
