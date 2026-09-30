"use client";
// Daily note / work journal: assembled automatically (work done, tasks
// created, meetings, decisions, learning) plus the user's own notes.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CheckCircle2, PlusCircle, CalendarDays, Gavel, Lightbulb, Loader2, Sparkles, Timer, FilePlus2, FilePenLine, RotateCcw, MessageSquare, Save, History, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { RichEditor, type SaveState } from "@/components/editor/rich-editor";
import { Markdown } from "@/components/ai/markdown";
import { api } from "@/lib/api-client";
import { Card } from "./brain-hub";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";

interface SavedNote {
  id: string;
  date: string;
  title: string;
  content: string;
  createdAt: string;
}
const NOTES_WIDTH_KEY = "woli.journal.notesWidth";
const MIN_NOTES = 280;
const MAX_NOTES = 760;

interface Item {
  id: string;
  label: string;
  sub?: string;
  href?: string;
}
interface TimelineEvent {
  at: string;
  type: "completed" | "created" | "meeting" | "decision" | "wrote" | "edited" | "reviewed" | "focus" | "comment";
  title: string;
  sub?: string;
  href?: string;
}
const EVENT_META: Record<TimelineEvent["type"], { icon: typeof Gavel; tone: string }> = {
  completed: { icon: CheckCircle2, tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50" },
  created: { icon: PlusCircle, tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50" },
  meeting: { icon: CalendarDays, tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50" },
  decision: { icon: Gavel, tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50" },
  wrote: { icon: FilePlus2, tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50" },
  edited: { icon: FilePenLine, tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50" },
  reviewed: { icon: RotateCcw, tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50" },
  focus: { icon: Timer, tone: "text-indigo-600 bg-indigo-50 dark:bg-indigo-950/50" },
  comment: { icon: MessageSquare, tone: "text-neutral-600 bg-neutral-100 dark:bg-neutral-800" },
};
interface Day {
  date: string;
  timeline: TimelineEvent[];
  completed: Item[];
  created: Item[];
  meetings: Item[];
  decisions: Item[];
  learning: Item[];
  focusMinutes: number;
  notes: string | null;
  aiSummary: string | null;
}

const localDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const shift = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

export function Journal({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const [date, setDate] = useState(localDate());
  const [day, setDay] = useState<Day | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [busy, setBusy] = useState(false);
  const tz = new Date().getTimezoneOffset();
  // The note being written (every keystroke), what the history holds, and the notes panel width.
  const draft = useRef("");
  const [editorKey, setEditorKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<SavedNote[] | null>(null);
  const [historyScope, setHistoryScope] = useState<"day" | "all">("day");
  const [openNote, setOpenNote] = useState<SavedNote | null>(null);
  const [notesWidth, setNotesWidth] = useState(360);
  const layoutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      const w = Number(localStorage.getItem(NOTES_WIDTH_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore this viewer's preferred width
      if (w >= MIN_NOTES && w <= MAX_NOTES) setNotesWidth(w);
    } catch {
      // storage unavailable: keep the default
    }
  }, []);
  const loadHistory = useCallback(() => {
    api
      .get<SavedNote[]>(`/api/workspaces/${workspaceId}/journal/notes${historyScope === "day" ? `?date=${date}` : ""}`)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [workspaceId, date, historyScope]);
  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  async function saveNote() {
    const content = draft.current;
    if (!content.trim()) return toast.info(t("brain.journal.noteEmpty"));
    setSaving(true);
    try {
      await api.post(`/api/workspaces/${workspaceId}/journal/notes`, { date, content });
      // The note is in the history now: start a fresh one.
      await api.put(`/api/workspaces/${workspaceId}/journal`, { date, notes: null });
      draft.current = "";
      setDay((d) => (d ? { ...d, notes: null } : d));
      setEditorKey((k) => k + 1);
      toast.success(t("brain.journal.noteSaved"));
      loadHistory();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }
  async function deleteNote(n: SavedNote) {
    if (!confirm(t("brain.journal.noteDeleteConfirm"))) return;
    await api.delete(`/api/journal-notes/${n.id}`).catch((e) => toast.error(e.message));
    setOpenNote(null);
    loadHistory();
  }
  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    const box = layoutRef.current?.getBoundingClientRect();
    if (!box) return;
    const move = (ev: PointerEvent) => setNotesWidth(Math.round(Math.min(MAX_NOTES, Math.max(MIN_NOTES, box.right - ev.clientX, 0))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setNotesWidth((w) => {
        try {
          localStorage.setItem(NOTES_WIDTH_KEY, String(w));
        } catch {
          // not persisted
        }
        return w;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- show the loader while switching days
    setDay(null);
    api
      .get<Day>(`/api/workspaces/${workspaceId}/journal?date=${date}&tz=${tz}`)
      .then((d) => !cancelled && setDay(d))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [workspaceId, date, tz]);

  async function summarize() {
    setBusy(true);
    try {
      const r = await api.post<{ aiSummary: string }>(`/api/workspaces/${workspaceId}/journal/summary`, { date, tz });
      setDay((d) => (d ? { ...d, aiSummary: r.aiSummary } : d));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const stats = day
    ? [
        { k: "completed", n: day.completed.length, icon: CheckCircle2, tone: "text-indigo-600" },
        { k: "created", n: day.created.length, icon: PlusCircle, tone: "text-indigo-600" },
        { k: "meetings", n: day.meetings.length, icon: CalendarDays, tone: "text-indigo-600" },
        { k: "decisions", n: day.decisions.length, icon: Gavel, tone: "text-indigo-600" },
        { k: "learning", n: day.learning.length, icon: Lightbulb, tone: "text-indigo-500" },
      ]
    : [];

  return (
    <div className="space-y-4" data-testid="journal">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="icon" variant="outline" onClick={() => setDate(shift(date, -1))} aria-label={t("brain.journal.prev")}>
          <ChevronLeft size={14} />
        </Button>
        <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm" data-testid="journal-date" />
        <Button size="icon" variant="outline" onClick={() => setDate(shift(date, 1))} aria-label={t("brain.journal.next")}>
          <ChevronRight size={14} />
        </Button>
        {date !== localDate() && (
          <Button size="sm" variant="ghost" onClick={() => setDate(localDate())}>
            {t("brain.journal.today")}
          </Button>
        )}
        {day && (
          <span className="text-xs text-neutral-500 inline-flex items-center gap-1 ml-2">
            <Timer size={12} /> {t("brain.journal.focus", { n: day.focusMinutes })}
          </span>
        )}
        <Button size="sm" variant="outline" className="ml-auto" onClick={summarize} disabled={busy || !day} data-testid="journal-summarize">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} {t("brain.journal.summarize")}
        </Button>
      </div>
      {!day ? (
        <div className="py-10 flex justify-center text-neutral-400">
          <Loader2 className="animate-spin" size={18} />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-5 gap-2" data-testid="journal-stats">
            {stats.map((x) => (
              <div key={x.k} className="rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 py-2" data-testid={`journal-${x.k}`}>
                <p className="text-[11px] text-neutral-500 inline-flex items-center gap-1 truncate">
                  <x.icon size={12} className={x.tone} /> {t(`brain.journal.${x.k}` as MessageKey)}
                </p>
                <p className="text-lg font-bold tabular-nums leading-tight">{x.n}</p>
              </div>
            ))}
          </div>
          <div ref={layoutRef} className="grid gap-4 lg:gap-0 lg:grid-cols-[minmax(0,1fr)_16px_var(--notes-w)]" style={{ "--notes-w": `${notesWidth}px` } as React.CSSProperties} data-testid="journal-layout">
            <Card title={t("brain.journal.timeline")} icon={<CalendarDays size={15} className="text-indigo-600" />} testId="journal-timeline">
              {day.timeline.length ? (
                <ol className="relative">
                  {day.timeline.map((e, i) => {
                    const M = EVENT_META[e.type];
                    return (
                      <li key={i} className="flex gap-3 group" data-testid="journal-event" data-type={e.type}>
                        <span className="w-11 shrink-0 pt-1.5 text-right text-[11px] tabular-nums text-neutral-400">{time(e.at)}</span>
                        <span className="relative flex flex-col items-center">
                          <span className={cn("h-7 w-7 rounded-full flex items-center justify-center z-10", M.tone)}>
                            <M.icon size={13} />
                          </span>
                          {i < day.timeline.length - 1 && <span className="flex-1 w-px bg-neutral-200 dark:bg-neutral-800" />}
                        </span>
                        <div className="min-w-0 flex-1 pb-3 pt-0.5">
                          <p className="text-[11px] text-neutral-500">{t(`brain.journal.ev.${e.type}` as MessageKey)}</p>
                          {e.href ? (
                            <Link href={e.href} className="text-sm font-medium hover:text-indigo-600 line-clamp-1">
                              {e.title}
                            </Link>
                          ) : (
                            <p className="text-sm font-medium line-clamp-1">{e.title}</p>
                          )}
                          {e.sub && <p className="text-xs text-neutral-500 line-clamp-2">{e.sub}</p>}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <div className="px-2 py-4 text-sm text-neutral-500">
                  <p>{t("brain.journal.emptyDay")}</p>
                  <p className="text-xs mt-1">{t("brain.journal.emptyDayHint")}</p>
                </div>
              )}
            </Card>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={t("brain.journal.resize")}
              title={t("brain.journal.resize")}
              onPointerDown={startResize}
              onDoubleClick={() => setNotesWidth(360)}
              className="hidden lg:flex items-center justify-center cursor-col-resize group"
              data-testid="journal-resize"
            >
              <span className="h-16 w-1 rounded-full bg-neutral-200 dark:bg-neutral-800 group-hover:bg-indigo-400 transition-colors" />
            </div>
            <div className="space-y-4 min-w-0">
          {day.aiSummary && (
            <Card title={t("brain.journal.aiSummary")} icon={<Sparkles size={15} className="text-indigo-600" />} testId="journal-ai">
              <Markdown text={day.aiSummary} className="text-sm" />
            </Card>
          )}
          <Card
            title={t("brain.journal.notes")}
            icon={<Lightbulb size={15} className="text-neutral-500" />}
            testId="journal-notes"
            action={
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-neutral-400">{saveState === "saving" ? t("brain.journal.draftSaving") : saveState === "saved" ? t("brain.journal.draftSaved") : ""}</span>
                <Button size="sm" onClick={saveNote} disabled={saving} data-testid="journal-save-note">
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {t("brain.journal.saveNote")}
                </Button>
              </span>
            }
          >
            <RichEditor
              key={`${date}-${editorKey}`}
              onChange={(html) => (draft.current = html)}
              content={day.notes}
              editable
              minHeight={160}
              workspaceId={workspaceId}
              placeholder={t("brain.journal.notesPh")}
              onSaveStateChange={setSaveState}
              onSave={async (html) => {
                await api.put(`/api/workspaces/${workspaceId}/journal`, { date, notes: html || null });
              }}
            />
            <p className="mt-2 text-[11px] text-neutral-400">{t("brain.journal.saveHint")}</p>
          </Card>
          <Card
            title={t("brain.journal.history")}
            icon={<History size={15} className="text-indigo-600" />}
            testId="journal-history"
            action={
              <span className="flex rounded-md bg-neutral-100 dark:bg-neutral-800 p-0.5 text-[11px]">
                {(["day", "all"] as const).map((sc) => (
                  <button key={sc} onClick={() => setHistoryScope(sc)} className={cn("px-2 py-0.5 rounded", historyScope === sc ? "bg-white dark:bg-neutral-900 shadow-sm text-indigo-700 dark:text-indigo-300" : "text-neutral-500")} data-testid={`journal-history-${sc}`}>
                    {t(sc === "day" ? "brain.journal.historyDay" : "brain.journal.historyAll")}
                  </button>
                ))}
              </span>
            }
          >
            {!history ? (
              <Loader2 size={14} className="animate-spin text-neutral-400" />
            ) : history.length === 0 ? (
              <p className="text-xs text-neutral-500">{t("brain.journal.historyEmpty")}</p>
            ) : (
              <ul className="space-y-1.5 max-h-80 overflow-y-auto thin-scroll -mx-1 px-1">
                {history.map((n) => (
                  <li key={n.id}>
                    <button onClick={() => setOpenNote(n)} className="w-full text-left rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 hover:border-indigo-300" data-testid="journal-history-item">
                      <span className="block text-sm font-medium truncate">{n.title}</span>
                      <span className="block text-[11px] text-neutral-400">{historyScope === "all" ? `${n.date.split("-").reverse().join("/")} ` : ""}{time(n.createdAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {openNote && (
            <Dialog open onOpenChange={(o) => !o && setOpenNote(null)}>
              <DialogContent className="max-w-2xl">
                <DialogTitle>{openNote.title}</DialogTitle>
                <p className="text-xs text-neutral-500">{openNote.date.split("-").reverse().join("/")} {time(openNote.createdAt)}</p>
                <div className="mt-3 max-h-[60vh] overflow-y-auto thin-scroll">
                  <RichEditor content={openNote.content} editable={false} onSave={async () => {}} />
                </div>
                <div className="mt-4 flex justify-between">
                  <Button variant="ghost" className="text-red-600" onClick={() => deleteNote(openNote)} data-testid="journal-note-delete">
                    <Trash2 size={13} /> {t("common.delete")}
                  </Button>
                  <Button variant="outline" onClick={() => setOpenNote(null)}>
                    {t("common.close")}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
