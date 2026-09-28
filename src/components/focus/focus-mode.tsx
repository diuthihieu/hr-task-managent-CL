"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { create } from "zustand";
import { Play, Pause, CheckCircle2, X, Timer, Maximize2, Minimize2, Plus, Trash2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

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
  task: { id: string; title: string; estimateMinutes: number | null; actualMinutes: number | null; link: string } | null;
}

interface FocusState {
  session: FocusSessionDto | null;
  /** Client time when `session.elapsedSeconds` was measured. */
  syncedAt: number;
  expanded: boolean;
  set: (p: Partial<FocusState>) => void;
}
export const useFocus = create<FocusState>((set) => ({ session: null, syncedAt: 0, expanded: false, set: (p) => set(p) }));

const adopt = (s: FocusSessionDto | null) => useFocus.getState().set({ session: s && (s.status === "running" || s.status === "paused") ? s : null, syncedAt: Date.now() });

export async function refreshFocus() {
  adopt(await api.get<FocusSessionDto | null>("/api/focus/active"));
}

export async function startFocus(taskId: string, plannedMinutes?: number) {
  const s = await api.post<FocusSessionDto>(`/api/tasks/${taskId}/focus`, plannedMinutes ? { plannedMinutes } : {});
  adopt(s);
  useFocus.getState().set({ expanded: true });
  return s;
}

async function patchFocus(body: Record<string, unknown>) {
  const cur = useFocus.getState().session;
  if (!cur) return null;
  const s = await api.patch<FocusSessionDto>(`/api/focus/${cur.id}`, body);
  adopt(s);
  return s;
}

const fmt = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
};

function useElapsed() {
  const { session, syncedAt } = useFocus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!session?.running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [session?.running]);
  if (!session) return 0;
  return session.elapsedSeconds + (session.running ? Math.max(0, Math.floor((now - syncedAt) / 1000)) : 0);
}

/** "Start focus" button for a task. */
export function StartFocusButton({ taskId, className, compact }: { taskId: string; className?: string; compact?: boolean }) {
  const { t } = useT();
  const active = useFocus((s) => s.session);
  const isThis = active?.taskId === taskId;
  return (
    <Button
      variant={isThis ? "secondary" : "outline"}
      className={className}
      onClick={async () => {
        if (isThis) return useFocus.getState().set({ expanded: true });
        try {
          await startFocus(taskId);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : t("common.failed"));
        }
      }}
      data-testid="start-focus"
    >
      <Timer size={14} /> {compact ? null : isThis ? t("focus.inFocus") : t("focus.start")}
    </Button>
  );
}

/** Always-mounted focus dock: a small pill while focusing, a full panel when expanded. */
export function FocusDock() {
  const { t } = useT();
  const { session, expanded, set } = useFocus();
  const elapsed = useElapsed();
  const [notes, setNotes] = useState("");
  const [newItem, setNewItem] = useState("");
  const [completeTask, setCompleteTask] = useState(true);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionId = session?.id;

  useEffect(() => {
    refreshFocus().catch(() => {});
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load the notes of a newly opened session
    setNotes(useFocus.getState().session?.notes ?? "");
  }, [sessionId]);

  if (!session) return null;
  const planned = session.plannedMinutes ? session.plannedMinutes * 60 : null;
  const over = planned !== null && elapsed > planned;
  const pct = planned ? Math.min(100, (elapsed / planned) * 100) : 0;

  const act = (body: Record<string, unknown>, ok?: string) =>
    patchFocus(body)
      .then(() => ok && toast.success(ok))
      .catch((e) => toast.error(e instanceof Error ? e.message : t("common.failed")));

  const saveChecklist = (list: ChecklistItem[]) => {
    useFocus.getState().set({ session: { ...session, checklist: list } });
    act({ checklist: list });
  };

  if (!expanded)
    return (
      <div className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-neutral-900 text-white shadow-xl pl-3 pr-1.5 py-1.5" data-testid="focus-pill">
        <Timer size={14} className={cn(session.running && "animate-pulse text-indigo-300")} />
        <button onClick={() => set({ expanded: true })} className="text-sm font-mono tabular-nums">{fmt(elapsed)}</button>
        <span className="text-xs text-neutral-300 max-w-40 truncate">{session.task?.title}</span>
        <button onClick={() => act({ action: session.running ? "pause" : "resume" })} className="rounded-full p-1.5 hover:bg-white/10" title={session.running ? t("focus.pause") : t("focus.resume")}>
          {session.running ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button onClick={() => set({ expanded: true })} className="rounded-full p-1.5 hover:bg-white/10" title={t("focus.open")}>
          <Maximize2 size={13} />
        </button>
      </div>
    );

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950/60 backdrop-blur-sm flex items-center justify-center p-4" data-testid="focus-panel">
      <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-neutral-100 dark:border-neutral-800">
          <Timer size={16} className="text-indigo-600" />
          <span className="text-sm font-semibold">{t("focus.title")}</span>
          <button onClick={() => set({ expanded: false })} className="ml-auto rounded p-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t("focus.minimize")}>
            <Minimize2 size={15} />
          </button>
        </div>
        <div className="p-6 space-y-5">
          <div className="text-center">
            {session.task && (
              <Link href={session.task.link} onClick={() => set({ expanded: false })} className="text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:text-indigo-600 line-clamp-2">
                {session.task.title}
              </Link>
            )}
            <div className={cn("mt-3 text-6xl font-bold font-mono tabular-nums tracking-tight", over ? "text-amber-600" : "text-neutral-900 dark:text-neutral-50")} data-testid="focus-timer">
              {fmt(elapsed)}
            </div>
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
                notesTimer.current = setTimeout(() => act({ notes: v }), 800);
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
        <div className="flex items-center gap-2 px-5 py-3 border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900">
          <Button variant="ghost" onClick={() => confirm(t("focus.cancelConfirm")) && act({ action: "cancel" })}>
            <X size={14} /> {t("focus.cancel")}
          </Button>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => act({ action: session.running ? "pause" : "resume" })} data-testid="focus-toggle">
              {session.running ? <Pause size={14} /> : <Play size={14} />} {session.running ? t("focus.pause") : t("focus.resume")}
            </Button>
            <Button
              onClick={async () => {
                if (notesTimer.current) clearTimeout(notesTimer.current);
                await act({ action: "complete", notes, completeTask }, t("focus.saved", { min: Math.max(1, Math.round(elapsed / 60)) }));
                set({ expanded: false });
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
