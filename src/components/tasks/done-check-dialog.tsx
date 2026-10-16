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
import type { DoneCheckField } from "@/lib/done-check";
import type { MessageKey } from "@/lib/i18n/core";
import type { RecordRow } from "@/types";

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
  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && close()}>
      {pending && (
        <DialogContent data-testid="done-check-dialog">
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
  const [completed, setCompleted] = useState<string | null>(pending.missing.includes("sys_completed_at") ? localNow() : null);
  const [saving, setSaving] = useState(false);
  const has = (f: DoneCheckField) => pending.missing.includes(f);

  async function save() {
    const data: Record<string, unknown> = {};
    if (has("sys_actual") && actual.trim()) {
      const h = Number(actual.replace(",", "."));
      if (!Number.isFinite(h) || h < 0) return toast.error(t("doneCheck.badHours"));
      data.sys_actual = h;
    }
    if (has("sys_start_date") && start) data.sys_start_date = start;
    if (has("sys_due_date") && due) data.sys_due_date = due;
    if (has("sys_completed_at") && completed) data.sys_completed_at = new Date(completed).toISOString();
    if (!Object.keys(data).length) return onClose();
    setSaving(true);
    try {
      const saved = await api.patch<RecordRow>(`/api/tasks/${pending.taskId}`, { data });
      pending.onSaved?.(saved);
      toast.success(t("doneCheck.saved"));
      onClose();
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
            <span className="font-medium">{label("sys_completed_at")}</span>
            <DateInput type="datetime-local" value={completed} onCommit={setCompleted} className="mt-1 w-full h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-transparent px-2 text-sm" data-testid="done-check-completed" />
          </label>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} data-testid="done-check-ignore">
          {t("doneCheck.ignore")}
        </Button>
        <Button onClick={save} disabled={saving} data-testid="done-check-save">
          {t("doneCheck.fill")}
        </Button>
      </div>
    </>
  );
}
