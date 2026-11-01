"use client";
import { useState } from "react";
import { create } from "zustand";
import { Clock } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import type { RecordRow } from "@/types";

/** As returned by the server (src/server/tasks/hours-check.ts). */
export interface HoursConflict {
  parentId: string;
  parentTitle: string;
  estimate: { current: number; min: number } | null;
  actual: { current: number; min: number } | null;
}

type Pending = HoursConflict & { onSaved?: (record: RecordRow) => void };

const useHoursCheck = create<{ queue: Pending[]; push: (p: Pending) => void; shift: () => void }>((set) => ({
  queue: [],
  push: (p) => set((s) => ({ queue: [...s.queue.filter((x) => x.parentId !== p.parentId), p].slice(-20) })),
  shift: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

/** After a save: when a parent now has fewer hours than its sub-tasks add up to, ask for the right ones. */
export function promptHoursCheck(saved: unknown, onSaved?: (record: RecordRow) => void) {
  const conflict = (saved as { hoursConflict?: HoursConflict } | null)?.hoursConflict;
  if (conflict) useHoursCheck.getState().push({ ...conflict, onSaved });
}

/** Mounted once in the workspace shell. */
export function HoursCheckDialog() {
  const pending = useHoursCheck((s) => s.queue[0] ?? null);
  const close = () => useHoursCheck.getState().shift();
  return (
    <Dialog open={!!pending} onOpenChange={(o) => !o && close()}>
      {pending && (
        <DialogContent data-testid="hours-check-dialog">
          <HoursForm key={pending.parentId} pending={pending} onClose={close} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function HoursForm({ pending, onClose }: { pending: Pending; onClose: () => void }) {
  const { t } = useT();
  const [estimate, setEstimate] = useState(pending.estimate ? String(pending.estimate.min) : "");
  const [actual, setActual] = useState(pending.actual ? String(pending.actual.min) : "");
  const [saving, setSaving] = useState(false);

  async function save() {
    const data: Record<string, number> = {};
    for (const [key, raw, need] of [["sys_estimate", estimate, pending.estimate], ["sys_actual", actual, pending.actual]] as const) {
      if (!need) continue;
      const h = Number(raw.replace(",", "."));
      if (!Number.isFinite(h) || h < need.min) return toast.error(t("hoursCheck.tooLow", { min: need.min }));
      data[key] = h;
    }
    setSaving(true);
    try {
      const saved = await api.patch<RecordRow>(`/api/tasks/${pending.parentId}`, { data });
      pending.onSaved?.(saved);
      toast.success(t("hoursCheck.saved"));
      onClose();
      promptHoursCheck(saved, pending.onSaved); // its own parent may need the same correction
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  const row = (label: string, need: { current: number; min: number }, value: string, set: (v: string) => void, id: string) => (
    <label className="block text-xs">
      <span className="font-medium">{label}</span>
      <span className="ml-1 text-neutral-500">{t("hoursCheck.now", { current: need.current, min: need.min })}</span>
      <Input inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} className="mt-1" data-testid={id} />
    </label>
  );
  return (
    <>
      <DialogTitle className="flex items-center gap-2">
        <Clock size={16} className="text-amber-600" />
        {t("hoursCheck.title")}
      </DialogTitle>
      <p className="text-xs text-neutral-500 mb-3">
        <span className="font-medium text-neutral-700 dark:text-neutral-300">{pending.parentTitle}</span> {t("hoursCheck.lead")}
      </p>
      <div className="space-y-3">
        {pending.estimate && row(t("field.sys_estimate"), pending.estimate, estimate, setEstimate, "hours-check-estimate")}
        {pending.actual && row(t("field.sys_actual"), pending.actual, actual, setActual, "hours-check-actual")}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} data-testid="hours-check-later">
          {t("hoursCheck.later")}
        </Button>
        <Button onClick={save} disabled={saving} data-testid="hours-check-save">
          {t("hoursCheck.save")}
        </Button>
      </div>
    </>
  );
}
