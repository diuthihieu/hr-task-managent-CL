"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Square, Sparkles, AlertTriangle, RotateCw, CheckCircle2, Pencil, Folder, CalendarClock, Users, Flag, Send, Tag, Timer, ExternalLink } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";
import { Markdown } from "./markdown";
import { AiHealthCheck } from "./ai-health-check";
import type { TaskIntake, TaskDraft, IntakeMessage } from "./use-task-intake";

/**
 * Chat for the AI task intake: the user describes a task, the AI asks what is
 * missing, then shows a draft card; nothing is created until "Confirm". Used
 * by the project chat widget and the Workspace Intelligence "Create tasks" tab.
 */
export function TaskIntakeChat({
  intake,
  compact,
  emptyTitle,
  suggestions,
  onOpenTask,
}: {
  intake: TaskIntake;
  compact?: boolean;
  emptyTitle: string;
  suggestions: string[];
  /** Open a created task in place (project chat); otherwise its page link is used. */
  onOpenTask?: (created: NonNullable<IntakeMessage["created"]>) => boolean;
}) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { messages, busy } = intake;
  const lastSummaryId = [...messages].reverse().find((m) => m.type === "summary" || m.type === "created")?.id;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, intake.error]);

  function submit() {
    if (!text.trim() || busy) return;
    intake.send(text);
    setText("");
    setEditing(false);
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="intake-chat">
      <div className={cn("flex-1 overflow-y-auto thin-scroll", compact ? "px-3 py-3" : "px-6 py-6")}>
        <div className={cn("mx-auto space-y-3", !compact && "max-w-3xl")}>
          {!intake.canCreate && <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 text-xs px-3 py-2">{t("intake.viewer")}</div>}
          {messages.length === 0 && (
            <div className={cn("text-center", compact ? "pt-4" : "pt-14")}>
              <span className="inline-flex h-11 w-11 rounded-2xl bg-indigo-50 dark:bg-indigo-950 text-indigo-600 items-center justify-center mb-3">
                <Sparkles size={20} />
              </span>
              <h2 className="font-semibold text-neutral-900 dark:text-neutral-50 text-[15px]">{emptyTitle}</h2>
              <p className="text-xs text-neutral-500 mt-1 max-w-sm mx-auto">{t("intake.emptyBody")}</p>
              <div className={cn("mt-4 grid gap-2", !compact && "sm:grid-cols-2")}>
                {suggestions.map((s) => (
                  <button key={s} onClick={() => intake.send(s)} disabled={busy} className="text-left text-[13px] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2 hover:border-indigo-300 hover:bg-indigo-50/40 disabled:opacity-50" data-testid="intake-suggestion">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end">
                <div className={cn("max-w-[85%] bg-indigo-600 text-white px-3.5 py-2 text-sm whitespace-pre-wrap", compact ? "rounded-[20px]" : "rounded-2xl rounded-br-md")} data-testid="intake-user-msg">
                  {m.content}
                </div>
              </div>
            ) : m.type === "created" && m.created ? (
              <CreatedCard key={m.id} created={m.created} onOpenTask={onOpenTask} />
            ) : (
              <div key={m.id} className="flex gap-2" data-testid="intake-answer" data-type={m.type}>
                <span className="h-7 w-7 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles size={13} />
                </span>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className={cn("px-3.5 py-2.5 text-sm", compact ? "rounded-[20px] bg-neutral-100 dark:bg-neutral-800" : "rounded-2xl rounded-tl-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900")}>{m.pending ? <TypingDots /> : <Markdown text={m.content} />}</div>
                  {m.type === "summary" && m.draft && (
                    <DraftCard
                      draft={m.draft}
                      active={m.id === lastSummaryId && intake.draft !== null}
                      creating={intake.creating}
                      onConfirm={() => intake.confirm(intake.draft ?? m.draft!)}
                      onChange={() => {
                        setEditing(true);
                        inputRef.current?.focus();
                      }}
                    />
                  )}
                </div>
              </div>
            )
          )}
          {intake.error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm px-3 py-2 space-y-2" data-testid="intake-error">
              <div className="break-words">{intake.errorStatus === 503 ? t("ai.busy") : intake.errorStatus === 429 ? t("ai.quota") : intake.error}</div>
              <div className="flex flex-wrap items-start gap-2">
                {intake.failedText && (
                  <button onClick={intake.retry} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 text-white px-2.5 py-1 text-xs font-medium hover:bg-indigo-500 disabled:opacity-50">
                    <RotateCw size={12} /> {t("ai.retry")}
                  </button>
                )}
                {intake.errorStatus === 503 && <AiHealthCheck />}
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>
      <div className={cn("bg-white dark:bg-neutral-900", compact ? "p-2.5" : "p-4 border-t border-neutral-200 dark:border-neutral-800")}>
        <div className={cn("mx-auto flex items-end gap-2 px-3 py-2", compact ? "rounded-[22px] bg-neutral-100 dark:bg-neutral-800 focus-within:ring-2 focus-within:ring-indigo-200 dark:focus-within:ring-indigo-900" : "max-w-3xl rounded-2xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 dark:focus-within:ring-indigo-950")}>
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={compact ? 1 : 2}
            maxLength={4000}
            placeholder={editing ? t("intake.changePh") : t("intake.placeholder")}
            className="flex-1 resize-none bg-transparent outline-none text-sm text-neutral-800 dark:text-neutral-100 placeholder:text-neutral-400 max-h-40 py-1"
            data-testid="intake-input"
          />
          {busy ? (
            <button onClick={intake.stop} className="h-8 w-8 rounded-full bg-neutral-800 text-white flex items-center justify-center shrink-0" title={t("ai.stop")}>
              <Square size={12} />
            </button>
          ) : (
            <button onClick={submit} disabled={!text.trim()} className="h-8 w-8 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 disabled:opacity-40" title={t("ai.send")} data-testid="intake-send">
              <ArrowUp size={15} />
            </button>
          )}
        </div>
        {!compact && <p className="text-[10px] text-neutral-400 text-center mt-1.5">{t("ai.disclaimer")}</p>}
      </div>
    </div>
  );
}

function DraftCard({ draft, active, creating, onConfirm, onChange }: { draft: TaskDraft; active: boolean; creating: boolean; onConfirm: () => void; onChange: () => void }) {
  const { t } = useT();
  const due = draft.dueDate ? `${draft.dueDate.split("-").reverse().join("/")}${draft.dueTime ? ` ${draft.dueTime}` : ""}` : "—";
  const rows: { icon: typeof Folder; label: string; value: React.ReactNode; missing?: boolean }[] = [
    { icon: Folder, label: t("intake.f.project"), value: draft.projectName ?? "—", missing: draft.missing.includes("project") },
    { icon: CalendarClock, label: t("intake.f.due"), value: due },
    { icon: Users, label: t("intake.f.assignees"), value: draft.assignees.length ? draft.assignees.map((a) => a.name).join(", ") : t("intake.me") },
    ...(draft.reportTo.length ? [{ icon: Send, label: t("intake.f.reportTo"), value: draft.reportTo.map((a) => a.name).join(", ") }] : []),
    { icon: Flag, label: t("intake.f.priority"), value: t(`intake.p.${draft.priority}` as MessageKey) },
    ...(draft.category ? [{ icon: Tag, label: t("intake.f.category"), value: draft.category.name }] : []),
    ...(draft.estimateHours ? [{ icon: Timer, label: t("intake.f.estimate"), value: `${draft.estimateHours}h` }] : []),
  ];
  const missing = draft.missing.map((f) => t(`intake.f.${f}` as MessageKey)).join(", ");
  return (
    <div className={cn("rounded-xl border bg-white dark:bg-neutral-900 overflow-hidden", active ? "border-indigo-200 dark:border-indigo-900 shadow-sm" : "border-neutral-200 dark:border-neutral-800 opacity-70")} data-testid="intake-draft">
      <div className="px-3.5 pt-3 pb-2 border-b border-neutral-100 dark:border-neutral-800">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-indigo-600">{t("intake.draft")}</div>
        <div className="mt-0.5 font-semibold text-sm text-neutral-900 dark:text-neutral-50 break-words" data-testid="intake-draft-title">
          {draft.title || "—"}
        </div>
      </div>
      <dl className="px-3.5 py-2 space-y-1.5 text-[12.5px]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-2">
            <r.icon size={13} className={cn("mt-0.5 shrink-0", r.missing ? "text-amber-500" : "text-indigo-500")} />
            <dt className="w-24 shrink-0 text-neutral-500">{r.label}</dt>
            <dd className={cn("flex-1 min-w-0 break-words", r.missing ? "text-amber-600" : "text-neutral-800 dark:text-neutral-200")}>{r.value}</dd>
          </div>
        ))}
        {draft.description && (
          <div className="pt-1 text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap line-clamp-4 border-t border-neutral-100 dark:border-neutral-800">
            <span className="text-neutral-500">{t("intake.f.details")}: </span>
            {draft.description}
          </div>
        )}
      </dl>
      {active && (
        <div className="px-3.5 pb-3 pt-1 space-y-2">
          {missing && (
            <div className="flex items-center gap-1.5 text-xs text-amber-600">
              <AlertTriangle size={12} /> {t("intake.missing", { fields: missing })}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button onClick={onConfirm} disabled={creating || draft.missing.length > 0} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-50" data-testid="intake-confirm">
              <CheckCircle2 size={13} /> {creating ? t("intake.creating") : t("intake.confirm")}
            </button>
            <button onClick={onChange} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-neutral-300 dark:border-neutral-700 text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800" data-testid="intake-change">
              <Pencil size={12} /> {t("intake.change")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CreatedCard({ created, onOpenTask }: { created: NonNullable<IntakeMessage["created"]>; onOpenTask?: (c: NonNullable<IntakeMessage["created"]>) => boolean }) {
  const { t } = useT();
  return (
    <div className="ml-9 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 px-3.5 py-2.5 flex items-center gap-2.5" data-testid="intake-created">
      <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">{t("intake.created")}</div>
        <div className="text-sm text-neutral-800 dark:text-neutral-100 truncate">
          {created.title}
          {created.projectName && <span className="text-neutral-500 text-xs"> {t("intake.createdIn", { project: created.projectName })}</span>}
        </div>
      </div>
      <Link
        href={created.href}
        onClick={(e) => {
          if (onOpenTask?.(created)) e.preventDefault();
        }}
        className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline shrink-0"
        data-testid="intake-open"
      >
        {t("intake.open")} <ExternalLink size={11} />
      </Link>
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
