"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { create } from "zustand";
import { Play, Pause, CheckCircle2, Square, Timer, Maximize2, Minimize2, Plus, Trash2, Search, ArrowRightLeft } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";
import { InlineArrow } from "@/components/ui/inline-arrow";

interface ChecklistItem {
  text: string;
  done: boolean;
}
export interface FocusSessionDto {
  id: string;
  taskId: string;
  status: "running" | "paused" | "completed" | "cancelled";
  plannedMinutes: number | null;
  elapsedSeconds: number;
  running: boolean;
  notes: string;
  checklist: ChecklistItem[];
  serverTime: string;
  startedAt?: string;
  endedAt?: string | null;
  runs?: FocusRunDto[];
  task: { id: string; title: string; estimateMinutes: number | null; actualMinutes: number | null; link: string } | null;
}

export interface FocusRunDto {
  startedAt: string;
  endedAt: string | null;
  startKind: string;
  endKind: string | null;
  seconds: number;
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "numeric" });
const dur = (sec: number) => {
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
};

/** Every start / resume of a session with its end time, how it ended and its length. */
export function FocusRunLog({ runs, startedAt, endedAt, testId = "focus-runs" }: { runs: FocusRunDto[]; startedAt?: string; endedAt?: string | null; testId?: string }) {
  const { t } = useT();
  if (!runs.length) return null;
  return (
    <div data-testid={testId}>
      {startedAt && (
        <p className="text-[11px] text-neutral-500 mb-1.5">
          {t("focus.log.session", { start: `${dayLabel(startedAt)} ${clock(startedAt)}` })}
          {endedAt ? ` ${t("focus.log.sessionEnd", { end: `${dayLabel(endedAt)} ${clock(endedAt)}` })}` : ""}
        </p>
      )}
      <ol className="space-y-1">
        {runs.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" data-testid="focus-run">
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", r.endedAt ? "bg-neutral-300 dark:bg-neutral-600" : "bg-emerald-500 animate-pulse")} />
            <span className="font-mono tabular-nums text-neutral-700 dark:text-neutral-200">
              {dayLabel(r.startedAt) !== dayLabel(runs[0].startedAt) && `${dayLabel(r.startedAt)} `}
              {clock(r.startedAt)} <InlineArrow /> {r.endedAt ? clock(r.endedAt) : t("focus.log.now")}
            </span>
            <span className="text-neutral-400">{t(`focus.log.start.${r.startKind}` as MessageKey)}</span>
            <span className="text-neutral-500">{r.endedAt ? t(`focus.log.end.${r.endKind ?? "stopped"}` as MessageKey) : t("focus.log.running")}</span>
            <span className="ml-auto font-medium tabular-nums">{dur(r.seconds)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

interface FocusState {
  /** Every open session: the running one first, then the paused ones. */
  sessions: FocusSessionDto[];
  /** The session shown in the big panel. */
  selectedId: string | null;
  /** Client time when the sessions' `elapsedSeconds` were measured. */
  syncedAt: number;
  expanded: boolean;
  set: (p: Partial<FocusState>) => void;
}
export const useFocus = create<FocusState>((set) => ({ sessions: [], selectedId: null, syncedAt: 0, expanded: false, set: (p) => set(p) }));

/** The running session, else the latest paused one. */
export const activeSession = (s: Pick<FocusState, "sessions">) => s.sessions.find((x) => x.running) ?? s.sessions[0] ?? null;
const selectedSession = (s: Pick<FocusState, "sessions" | "selectedId">) => s.sessions.find((x) => x.id === s.selectedId) ?? activeSession(s);

const adopt = (list: FocusSessionDto[]) => {
  const open = list.filter((s) => s.status === "running" || s.status === "paused");
  const { selectedId } = useFocus.getState();
  useFocus.getState().set({ sessions: open, syncedAt: Date.now(), selectedId: open.some((s) => s.id === selectedId) ? selectedId : (open[0]?.id ?? null), ...(open.length ? {} : { expanded: false }) });
};

export async function refreshFocus() {
  adopt(await api.get<FocusSessionDto[]>("/api/focus/active?all=1"));
}

/** Focus on a task: the running session pauses (its time is recorded) and this one runs. */
export async function startFocus(taskId: string, plannedMinutes?: number) {
  const s = await api.post<FocusSessionDto>(`/api/tasks/${taskId}/focus`, plannedMinutes ? { plannedMinutes } : {});
  await refreshFocus();
  useFocus.getState().set({ expanded: true, selectedId: s.id });
  return s;
}

async function patchFocus(id: string, body: Record<string, unknown>) {
  const s = await api.patch<FocusSessionDto>(`/api/focus/${id}`, body);
  // Resuming one pauses the others: reload the whole list.
  if (body.action) await refreshFocus();
  else useFocus.getState().set({ sessions: useFocus.getState().sessions.map((x) => (x.id === s.id ? { ...x, notes: s.notes, checklist: s.checklist, plannedMinutes: s.plannedMinutes } : x)) });
  return s;
}

const fmt = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
};

/** Live seconds of a session (ticks while it runs). */
function useTick(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return now;
}
function elapsedOf(s: FocusSessionDto | null, syncedAt: number, now: number) {
  if (!s) return 0;
  return s.elapsedSeconds + (s.running ? Math.max(0, Math.floor((now - syncedAt) / 1000)) : 0);
}

/** "Start focus" button for a task. */
export function StartFocusButton({ taskId, className, compact }: { taskId: string; className?: string; compact?: boolean }) {
  const { t } = useT();
  const mine = useFocus((s) => s.sessions.find((x) => x.taskId === taskId) ?? null);
  const isRunning = Boolean(mine?.running);
  return (
    <Button
      variant={isRunning ? "secondary" : "outline"}
      className={className}
      onClick={async () => {
        if (isRunning) return useFocus.getState().set({ expanded: true, selectedId: mine!.id });
        try {
          await startFocus(taskId);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t("common.failed"));
        }
      }}
      data-testid="start-focus"
    >
      <Timer size={14} /> {compact ? null : isRunning ? t("focus.inFocus") : mine ? t("focus.resume") : t("focus.start")}
    </Button>
  );
}

interface TaskOption {
  id: string;
  title: string;
  projectName: string;
}

/** Pick another task to focus on (your open tasks, or search). */
function TaskSwitcher({ workspaceId, busyTaskIds, onPick }: { workspaceId: string; busyTaskIds: Set<string>; onPick: (taskId: string) => void }) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [mine, setMine] = useState<TaskOption[]>([]);
  const [found, setFound] = useState<TaskOption[] | null>(null);
  useEffect(() => {
    api
      .get<{ tasks: { taskId: string; title: string; projectName: string; statusCategory: string }[] }>(`/api/workspaces/${workspaceId}/my-work`)
      .then((r) => setMine(r.tasks.filter((x) => x.statusCategory === "todo" || x.statusCategory === "in_progress").map((x) => ({ id: x.taskId, title: x.title, projectName: x.projectName }))))
      .catch(() => {});
  }, [workspaceId]);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear results when the query is too short
      setFound(null);
      return;
    }
    const id = setTimeout(() => {
      api
        .get<{ tasks: { id: string; label: string; projectName: string }[] }>(`/api/search?q=${encodeURIComponent(term)}&workspaceId=${workspaceId}`)
        .then((r) => setFound(r.tasks.map((x) => ({ id: x.id, title: x.label, projectName: x.projectName }))))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(id);
  }, [q, workspaceId]);
  const list = (found ?? mine).filter((x) => !busyTaskIds.has(x.id)).slice(0, 8);
  return (
    <div className="space-y-2" data-testid="focus-switcher">
      <div className="flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-700 px-2.5">
        <Search size={13} className="text-neutral-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("focus.switchSearch")} className="flex-1 bg-transparent py-1.5 text-sm outline-none" data-testid="focus-switch-search" />
      </div>
      <ul className="max-h-48 overflow-y-auto thin-scroll space-y-0.5">
        {list.length === 0 && <li className="text-xs text-neutral-400 px-1 py-2">{t("focus.switchEmpty")}</li>}
        {list.map((x) => (
          <li key={x.id}>
            <button onClick={() => onPick(x.id)} className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-indigo-50 dark:hover:bg-indigo-950/40" data-testid="focus-switch-task">
              <Play size={12} className="text-indigo-600 shrink-0" />
              <span className="flex-1 min-w-0 truncate text-sm">{x.title}</span>
              <span className="text-[11px] text-neutral-400 truncate max-w-32">{x.projectName}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Always-mounted focus dock. Collapsed: a bar at the bottom of the screen with
 * every open session - the running one with its live timer, paused ones you
 * can resume in one click. Expanded: the selected session with checklist and
 * notes, the list of sessions, and a picker to focus on another task (the
 * current one pauses and its time is recorded).
 */
export function FocusDock({ workspaceId }: { workspaceId: string }) {
  const { t } = useT();
  const { sessions, syncedAt, expanded, selectedId, set } = useFocus();
  const session = selectedSession({ sessions, selectedId });
  const running = sessions.find((x) => x.running) ?? null;
  const now = useTick(Boolean(running));
  const [notes, setNotes] = useState("");
  const [newItem, setNewItem] = useState("");
  const [completeTask, setCompleteTask] = useState(true);
  const [switching, setSwitching] = useState(false);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionId = session?.id;

  useEffect(() => {
    refreshFocus().catch(() => {});
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the notes of the session being shown
    setNotes(useFocus.getState().sessions.find((x) => x.id === sessionId)?.notes ?? "");
    setSwitching(false);
  }, [sessionId]);

  if (!session) return null;
  const elapsed = elapsedOf(session, syncedAt, now);
  const planned = session.plannedMinutes ? session.plannedMinutes * 60 : null;
  const over = planned !== null && elapsed > planned;
  const pct = planned ? Math.min(100, (elapsed / planned) * 100) : 0;

  const act = (id: string, body: Record<string, unknown>, ok?: string) =>
    patchFocus(id, body)
      .then(() => ok && toast.success(ok))
      .catch((e) => toast.error(e instanceof Error ? e.message : t("common.failed")));

  const saveChecklist = (list: ChecklistItem[]) => {
    set({ sessions: sessions.map((x) => (x.id === session.id ? { ...x, checklist: list } : x)) });
    act(session.id, { checklist: list });
  };
  const flushNotes = () => {
    if (notesTimer.current) clearTimeout(notesTimer.current);
    return notes !== session.notes ? patchFocus(session.id, { notes }).catch(() => {}) : Promise.resolve();
  };
  const focusTask = async (taskId: string) => {
    await flushNotes();
    try {
      await startFocus(taskId);
      toast.success(t("focus.switched"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  };

  if (!expanded)
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 max-w-[calc(100vw-7rem)] overflow-x-auto thin-scroll" data-testid="focus-pill">
        {sessions.map((x) => (
          <div key={x.id} className={cn("flex items-center gap-1.5 rounded-full shadow-lg pl-3 pr-1 py-1 shrink-0", x.running ? "bg-neutral-900 text-white" : "bg-white dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700")} data-testid="focus-chip" data-state={x.status}>
            <Timer size={13} className={cn(x.running && "animate-pulse text-indigo-300")} />
            <button onClick={() => set({ expanded: true, selectedId: x.id })} className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-mono tabular-nums">{fmt(elapsedOf(x, syncedAt, now))}</span>
              <span className="text-xs opacity-75 max-w-36 truncate">{x.task?.title}</span>
              {!x.running && <span className="text-[10px] uppercase tracking-wide opacity-60">{t("focus.pausedTag")}</span>}
            </button>
            <button onClick={() => act(x.id, { action: x.running ? "pause" : "resume" })} className={cn("rounded-full p-1.5", x.running ? "hover:bg-white/10" : "hover:bg-neutral-100 dark:hover:bg-neutral-700")} title={x.running ? t("focus.pause") : t("focus.resume")} data-testid="focus-chip-toggle">
              {x.running ? <Pause size={12} /> : <Play size={12} />}
            </button>
          </div>
        ))}
        <button onClick={() => set({ expanded: true })} className="rounded-full p-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 shadow-lg text-neutral-500 hover:text-indigo-600 shrink-0" title={t("focus.open")}>
          <Maximize2 size={13} />
        </button>
      </div>
    );

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950/60 backdrop-blur-sm flex items-center justify-center p-4" data-testid="focus-panel">
      <div className="w-full max-w-3xl max-h-[calc(100vh-2rem)] rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-neutral-100 dark:border-neutral-800">
          <Timer size={16} className="text-indigo-600" />
          <span className="text-sm font-semibold">{t("focus.title")}</span>
          <button onClick={() => flushNotes().then(() => set({ expanded: false }))} className="ml-auto rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t("focus.minimize")}>
            <Minimize2 size={15} />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col sm:flex-row">
          <aside className="sm:w-60 shrink-0 border-b sm:border-b-0 sm:border-r border-neutral-100 dark:border-neutral-800 p-3 space-y-3 overflow-y-auto thin-scroll bg-neutral-50/60 dark:bg-neutral-950/30">
            <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">{t("focus.sessions", { count: sessions.length })}</div>
            <ul className="space-y-1">
              {sessions.map((x) => (
                <li key={x.id}>
                  <button onClick={() => flushNotes().then(() => set({ selectedId: x.id }))} className={cn("w-full rounded-lg px-2.5 py-2 text-left border", x.id === session.id ? "border-indigo-300 bg-white dark:bg-neutral-900 dark:border-indigo-800" : "border-transparent hover:bg-white dark:hover:bg-neutral-900")} data-testid="focus-session-item" data-state={x.status}>
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <span className={cn("h-1.5 w-1.5 rounded-full", x.running ? "bg-emerald-500 animate-pulse" : "bg-amber-500")} />
                      <span className={x.running ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}>{x.running ? t("focus.runningTag") : t("focus.pausedTag")}</span>
                      <span className="ml-auto font-mono tabular-nums text-neutral-500">{fmt(elapsedOf(x, syncedAt, now))}</span>
                    </span>
                    <span className="block mt-0.5 text-sm text-neutral-800 dark:text-neutral-100 line-clamp-2">{x.task?.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            {switching ? (
              <TaskSwitcher workspaceId={workspaceId} busyTaskIds={new Set(running ? [running.taskId] : [])} onPick={focusTask} />
            ) : (
              <Button variant="outline" size="sm" className="w-full" onClick={() => setSwitching(true)} data-testid="focus-switch">
                <ArrowRightLeft size={13} /> {t("focus.switch")}
              </Button>
            )}
            <p className="text-[11px] text-neutral-400">{t("focus.switchHint")}</p>
          </aside>
          <div className="flex-1 min-w-0 overflow-y-auto thin-scroll p-6 space-y-5">
            <div className="text-center">
              {session.task && (
                <Link href={session.task.link} onClick={() => set({ expanded: false })} className="text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:text-indigo-600 line-clamp-2">
                  {session.task.title}
                </Link>
              )}
              <div className={cn("mt-3 text-6xl font-bold font-mono tabular-nums tracking-tight", over ? "text-amber-600" : session.running ? "text-neutral-900 dark:text-neutral-50" : "text-neutral-400")} data-testid="focus-timer">
                {fmt(elapsed)}
              </div>
              {!session.running && <div className="mt-1 text-xs text-amber-600">{t("focus.pausedNote")}</div>}
              {planned !== null && (
                <div className="mt-3 mx-auto max-w-sm">
                  <div className="h-1.5 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                    <div className={cn("h-full rounded-full", over ? "bg-amber-500" : "bg-indigo-500")} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="flex justify-between text-[11px] text-neutral-500 mt-1">
                    <span>{t("focus.planned", { min: session.plannedMinutes ?? 0 })}</span>
                    {session.task?.estimateMinutes ? <span>{t("focus.estimate", { h: Math.round((session.task.estimateMinutes / 60) * 10) / 10, a: Math.round(((session.task.actualMinutes ?? 0) / 60) * 10) / 10 })}</span> : null}
                  </div>
                </div>
              )}
            </div>

            {!!session.runs?.length && (
              <details className="rounded-lg border border-neutral-100 dark:border-neutral-800 px-3 py-2" open>
                <summary className="cursor-pointer text-[11px] font-semibold text-neutral-500 uppercase tracking-wide">{t("focus.log.title", { n: session.runs.length })}</summary>
                <div className="mt-2">
                  <FocusRunLog runs={session.runs} startedAt={session.startedAt} endedAt={session.endedAt} />
                </div>
              </details>
            )}

            <div>
              <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">{t("focus.checklist")}</div>
              <ul className="space-y-1">
                {session.checklist.map((item, i) => (
                  <li key={i} className="group flex items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={item.done} onChange={() => saveChecklist(session.checklist.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} />
                    <span className={cn("flex-1", item.done && "line-through text-neutral-400")}>{item.text}</span>
                    <button onClick={() => saveChecklist(session.checklist.filter((_, j) => j !== i))} className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-600">
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              <form
                className="flex gap-2 mt-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (newItem.trim()) saveChecklist([...session.checklist, { text: newItem.trim(), done: false }]);
                  setNewItem("");
                }}
              >
                <input value={newItem} onChange={(e) => setNewItem(e.target.value)} placeholder={t("focus.addStep")} className="flex-1 rounded-md border border-neutral-200 dark:border-neutral-700 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400" data-testid="focus-add-step" />
                <Button type="submit" variant="outline" size="icon">
                  <Plus size={14} />
                </Button>
              </form>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">{t("focus.notes")}</div>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value);
                  if (notesTimer.current) clearTimeout(notesTimer.current);
                  const v = e.target.value;
                  const id = session.id;
                  notesTimer.current = setTimeout(() => act(id, { notes: v }), 800);
                }}
                placeholder={t("focus.notesPh")}
                className="w-full resize-none rounded-md border border-neutral-200 dark:border-neutral-700 bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-indigo-400"
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={completeTask} onChange={(e) => setCompleteTask(e.target.checked)} />
              {t("focus.alsoComplete")}
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
          <Button variant="ghost" onClick={() => confirm(t("focus.cancelConfirm")) && flushNotes().then(() => act(session.id, { action: "cancel" }, t("focus.stopped")))} data-testid="focus-stop">
            <Square size={13} /> {t("focus.cancel")}
          </Button>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => act(session.id, { action: session.running ? "pause" : "resume" })} data-testid="focus-toggle">
              {session.running ? <Pause size={14} /> : <Play size={14} />} {session.running ? t("focus.pause") : t("focus.resume")}
            </Button>
            <Button
              onClick={async () => {
                if (notesTimer.current) clearTimeout(notesTimer.current);
                await act(session.id, { action: "complete", notes, completeTask }, t("focus.saved", { min: Math.max(1, Math.round(elapsed / 60)) }));
              }}
              data-testid="focus-complete"
            >
              <CheckCircle2 size={14} /> {t("focus.complete")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}


interface TaskFocusHistory {
  totalMinutes: number;
  sessions: { id: string; user: string; status: string; minutes: number; startedAt: string; endedAt: string | null; runs: FocusRunDto[] }[];
}

/** A task's focus history: who focused when (start, pauses, resumes, end) and for how long. */
export function TaskFocusHistory({ taskId }: { taskId: string }) {
  const { t } = useT();
  const [h, setH] = useState<TaskFocusHistory | null>(null);
  const running = useFocus((s) => s.sessions.find((x) => x.taskId === taskId)?.status);
  useEffect(() => {
    api.get<TaskFocusHistory>(`/api/tasks/${taskId}/focus`).then(setH).catch(() => {});
  }, [taskId, running]);
  if (!h || !h.sessions.length) return null;
  return (
    <details className="mt-3 rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2" data-testid="task-focus-history">
      <summary className="cursor-pointer text-xs font-medium text-neutral-600 dark:text-neutral-300 flex items-center gap-1.5">
        <Timer size={13} className="text-indigo-600" /> {t("focus.history", { n: h.sessions.length, total: dur(h.totalMinutes * 60) })}
      </summary>
      <ul className="mt-2 space-y-3">
        {h.sessions.map((s) => (
          <li key={s.id}>
            <div className="flex items-center gap-2 text-xs mb-1">
              <span className="font-medium">{s.user}</span>
              <span className="text-neutral-400">{t(`focus.status.${s.status}` as MessageKey)}</span>
              <span className="ml-auto tabular-nums font-medium">{dur(s.minutes * 60)}</span>
            </div>
            <FocusRunLog runs={s.runs} startedAt={s.startedAt} endedAt={s.endedAt} testId="task-focus-runs" />
          </li>
        ))}
      </ul>
    </details>
  );
}
