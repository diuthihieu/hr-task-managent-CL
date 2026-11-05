"use client";
import { useState } from "react";
import { create } from "zustand";
import { CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { DoneCheckField } from "@/lib/done-check";
import type { MessageKey } from "@/lib/i18n/core";
import type { RecordRow } from "@/types";
import { promptHoursCheck } from "./hours-check-dialog";

type Pending = { taskId: string; title?: string; missing: DoneCheckField[]; onSaved?: (record: RecordRow) => void };

/** Several tasks can finish at once (paste, bulk edit): they are asked about one after another. */
const useDoneCheck = create<{ queue: Pending[]; push: (p: Pending) => void; shift: () => void }>((set) => ({
  queue: [],
  push: (p) => set((s) => ({ queue: [...s.queue.filter((x) => x.taskId !== p.taskId), p].slice(-20) })),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

/**
 * After a save that finished a task: when the server reports empty details
 * (actual time, start, due, completed), ask the user to fill them in or ignore.
 */
export function promptDoneCheck(saved: unknown, onSaved?: (record: RecordRow) => void) {
  // Every save path calls this: it also asks to fix a parent whose hours fall below its sub-tasks'.
  promptHoursCheck(saved, onSaved);
  const rec = saved as (RecordRow & { doneMissing?: DoneCheckField[] }) | null;
  if (!rec?.id || !rec.doneMissing?.length) return;
  const title = typeof rec.data?.sys_title === "string" ? rec.data.sys_title : undefined;
  useDoneCheck.getState().push({ taskId: rec.id, title, missing: rec.doneMissing, onSaved });
}

/** Same prompt when only the task id and the missing fields are known (e.g. focus "complete"). */
export function promptDoneCheckFor(taskId: string, missing: DoneCheckField[] | undefined, title?: string, onSaved?: (record: RecordRow) => void) {
  if (missing?.length) useDoneCheck.getState().push({ taskId, title, missing, onSaved });
}

const pad = (n: number) => String(n).padStart(2, "0");
const localNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Mounted once in the workspace shell. */
export function DoneCheckDialog() {
  const pending = useDoneCheck((s) => s.queue[0] ?? null);
  const close = () => useDoneCheck.getState().shift();
  // The completed time is required: while it is missing the dialog can't be dismissed (Esc, outside
  // click, X); it closes once the form saves it.
  const required = !!pending?.missing.includes("sys_completed_at");
  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && !required && close()}>
      {pending && (
        <DialogContent data-testid="done-check-dialog" hideClose={required}>
          {/* Remount per task so the form starts empty. */}
          <DoneCheckForm key={pending.taskId} pending={pending} onClose={close} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function DoneCheckForm({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const { t } = useT();
  const [actual, setActual] = useState("");
  const [start, setStart] = useState<string | null>(null);
  const [due, setDue] = useState<string | null>(null);
  // Empty on purpose: the moment Done was clicked is often not when the work was finished.
  const [completed, setCompleted] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const has = (f: DoneCheckField) => pending.missing.includes(f);

  const required = has("sys_completed_at");
  const [completedError, setCompletedError] = useState(false);

  /** `completedOnly`: "skip the rest" - save just the (required) completed time. */
  async function save(completedOnly = false) {
    if (required && !completed) {
      setCompletedError(true);
      return toast.error(t("doneCheck.completedRequired"));
    }
    const data: Record<string, unknown> = {};
    if (completedOnly) {
      data.sys_completed_at = new Date(completed!).toISOString();
      return send(data);
    }
    if (has("sys_actual") && actual.trim()) {
      const h = Number(actual.replace(",", "."));
      if (!Number.isFinite(h) || h < 0) return toast.error(t("doneCheck.badHours"));
      data.sys_actual = h;
    }
    if (has("sys_start_date") && start) data.sys_start_date = start;
    if (has("sys_due_date") && due) data.sys_due_date = due;
    if (has("sys_completed_at") && completed) data.sys_completed_at = new Date(completed).toISOString();
    if (!Object.keys(data).length) return onClose();
    return send(data);
  }

  async function send(data: Record<string, unknown>) {
    setSaving(true);
    try {
      const saved = await api.patch<RecordRow>(`/api/tasks/${pending.taskId}`, { data });
      pending.onSaved?.(saved);
      toast.success(t("doneCheck.saved"));
      onClose();
      promptHoursCheck(saved, pending.onSaved); // the actual hours entered here can exceed the parent's
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  const label = (f: DoneCheckField) => t(`field.${f}` as MessageKey);
  return (
    <>
      <DialogTitle className="flex items-center gap-2">
        <CheckCircle2 size={16} className="text-emerald-600" />
        {t("doneCheck.title")}
      </DialogTitle>
      <p className="text-xs text-neutral-500 mb-3">
        {pending.title ? <span className="font-medium text-neutral-700 dark:text-neutral-300">{pending.title}</span> : null} {t("doneCheck.lead", { list: pending.missing.map(label).join(", ") })}
      </p>
      <div className="space-y-3">
        {has("sys_actual") && (
          <label className="block text-xs">
            <span className="font-medium">{label("sys_actual")}</span>
            <Input inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="1.5" className="mt-1" data-testid="done-check-actual" />
          </label>
        )}
        {has("sys_start_date") && (
          <label className="block text-xs">
            <span className="font-medium">{label("sys_start_date")}</span>
            <DateInput value={start} onCommit={setStart} className="mt-1 w-full h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 text-sm" data-testid="done-check-start" />
          </label>
        )}
        {has("sys_due_date") && (
          <label className="block text-xs">
            <span className="font-medium">{label("sys_due_date")}</span>
            <DateInput value={due} onCommit={setDue} className="mt-1 w-full h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 text-sm" data-testid="done-check-due" />
          </label>
        )}
        {has("sys_completed_at") && (
          <label className="block text-xs">
            <span className="font-medium">
              {label("sys_completed_at")} <span className="text-red-600">*</span>
            </span>
            <span className="mt-1 flex items-center gap-2">
              <DateInput
                type="datetime-local"
                value={completed}
                onCommit={(v) => {
                  setCompleted(v);
                  if (v) setCompletedError(false);
                }}
                aria-required
                aria-invalid={completedError || undefined}
                className={cn("w-full h-8 rounded-md border bg-transparent px-2 text-sm", completedError ? "border-red-500" : "border-neutral-300 dark:border-neutral-700")}
                data-testid="done-check-completed"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => {
                  setCompleted(localNow());
                  setCompletedError(false);
                }}
                data-testid="done-check-completed-now"
              >
                {t("doneCheck.now")}
              </Button>
            </span>
          </label>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        {required ? (
          // Skipping is only for the optional details: the completed time is still saved.
          <Button variant="ghost" onClick={() => void save(true)} disabled={saving || !completed} data-testid="done-check-ignore">
            {t("doneCheck.ignoreRest")}
          </Button>
        ) : (
          <Button variant="ghost" onClick={onClose} data-testid="done-check-ignore">
            {t("doneCheck.ignore")}
          </Button>
        )}
        <Button onClick={() => void save()} disabled={saving} data-testid="done-check-save">
          {t("doneCheck.fill")}
        </Button>
      </div>
    </>
  );
}
