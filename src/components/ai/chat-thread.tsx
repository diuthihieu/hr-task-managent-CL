"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, Sparkles, Copy, FileDown, AlertTriangle } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";
import { AiHealthCheck } from "./ai-health-check";
import type { ChatMessage } from "./use-ai-chat";

/** Message list + composer shared by the wiki assistant panel and the AI Assistant page. */
export function ChatThread({
  messages,
  busy,
  error,
  configured,
  onSend,
  onStop,
  onExportPdf,
  emptyTitle,
  emptyBody,
  suggestions = [],
  placeholder,
  compact,
}: {
  messages: ChatMessage[];
  busy: boolean;
  error: string | null;
  configured: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  onExportPdf?: (m: ChatMessage) => void;
  emptyTitle: string;
  emptyBody?: string | null;
  suggestions?: string[];
  placeholder: string;
  compact?: boolean;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  function submit() {
    if (!draft.trim() || busy) return;
    onSend(draft);
    setDraft("");
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className={cn("flex-1 overflow-y-auto thin-scroll", compact ? "px-3 py-3" : "px-6 py-6")}>
        <div className={cn("mx-auto space-y-4", !compact && "max-w-3xl")}>
          {!configured && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-3 text-xs text-amber-800 dark:text-amber-300 flex gap-2">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span className="flex-1">{t("ai.notConfigured")}</span>
            </div>
          )}
          {messages.length === 0 && (
            <div className={cn("text-center", compact ? "pt-6" : "pt-16")}>
              <span className="inline-flex h-12 w-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 items-center justify-center mb-3">
                <Sparkles size={22} />
              </span>
              <h2 className="font-semibold text-neutral-900 dark:text-neutral-50">{emptyTitle}</h2>
              {emptyBody && <p className="text-sm text-neutral-500 mt-1 max-w-md mx-auto whitespace-pre-line">{emptyBody}</p>}
              {suggestions.length > 0 && (
                <div className={cn("mt-5 grid gap-2", compact ? "" : "sm:grid-cols-2")}>
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => onSend(s)} disabled={busy || !configured} className="text-left text-[13px] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2.5 hover:border-indigo-300 hover:bg-indigo-50/40 disabled:opacity-50" data-testid="ai-suggestion">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 text-white px-3.5 py-2 text-sm whitespace-pre-wrap" data-testid="ai-user-msg">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={m.id} className="flex gap-2.5" data-testid="ai-answer">
                <span className="h-7 w-7 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles size={14} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="rounded-2xl rounded-tl-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-4 py-3">
                    {m.content ? <Markdown text={m.content} /> : <TypingDots />}
                  </div>
                  {!m.pending && m.content && (
                    <div className="flex gap-3 mt-1 ml-1 text-[11px] text-neutral-400">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(m.content).then(() => toast.success(t("ai.copied")));
                        }}
                        className="inline-flex items-center gap-1 hover:text-indigo-600"
                      >
                        <Copy size={11} /> {t("ai.copy")}
                      </button>
                      {onExportPdf && (
                        <button onClick={() => onExportPdf(m)} className="inline-flex items-center gap-1 hover:text-indigo-600" data-testid="ai-export-pdf">
                          <FileDown size={11} /> {t("ai.exportPdf")}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )
          )}
          {error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm px-3 py-2 space-y-2" data-testid="ai-error">
              <div className="break-words">{error}</div>
              <AiHealthCheck />
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
      <div className={cn("border-t border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900", compact ? "p-2.5" : "p-4")}>
        <div className={cn("mx-auto flex items-end gap-2 rounded-2xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 dark:focus-within:ring-indigo-950", !compact && "max-w-3xl")}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={compact ? 2 : 3}
            placeholder={placeholder}
            disabled={!configured}
            className="flex-1 resize-none bg-transparent outline-none text-sm text-neutral-800 dark:text-neutral-100 placeholder:text-neutral-400 max-h-48"
            data-testid="ai-input"
          />
          {busy ? (
            <button onClick={onStop} className="h-8 w-8 rounded-full bg-neutral-800 text-white flex items-center justify-center shrink-0" title={t("ai.stop")}>
              <Square size={12} />
            </button>
          ) : (
            <button onClick={submit} disabled={!draft.trim() || !configured} className="h-8 w-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 disabled:opacity-40" title={t("ai.send")} data-testid="ai-send">
              <ArrowUp size={15} />
            </button>
          )}
        </div>
        <p className="text-[10px] text-neutral-400 text-center mt-1.5">{t("ai.disclaimer")}</p>
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="…">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-1.5 w-1.5 rounded-full bg-neutral-400 animate-bounce" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </span>
  );
}
