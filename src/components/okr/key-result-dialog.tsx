"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import type { KeyResultRow, KeyResultType } from "@/types";
import { useT } from "@/components/i18n-provider";

export interface KeyResultDraft {
  title: string;
  ownerId: string;
  type: KeyResultType;
  startValue: number;
  targetValue: number;
  currentValue: number;
  unit: string;
  weight: number;
  manualProgress: number;
  status: string;
  confidence: number;
  dueDate: string;
}

function toDraft(kr: KeyResultRow | null): KeyResultDraft {
  return {
    title: kr?.title ?? "",
    ownerId: kr?.owner?.id ?? "",
    type: kr?.type ?? "task_based",
    startValue: kr?.startValue ?? 0,
    targetValue: kr?.targetValue ?? 100,
    currentValue: kr?.currentValue ?? 0,
    unit: kr?.unit ?? "",
    weight: kr?.weight ?? 1,
    manualProgress: kr?.manualProgress ?? 0,
    status: kr?.status ?? "on_track",
    confidence: kr?.confidence ?? 70,
    dueDate: kr?.dueDate ?? "",
  };
}

export function KeyResultDialog({
  open,
  onOpenChange,
  keyResult,
  members,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  keyResult: KeyResultRow | null;
  members: { id: string; name: string }[];
  onSave: (draft: KeyResultDraft) => void;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState<KeyResultDraft>(() => toDraft(keyResult));
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setDraft(toDraft(keyResult));
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  function patch(p: Partial<KeyResultDraft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>{keyResult ? t("okr.editKeyResult") : t("okr.newKeyResult")}</DialogTitle>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.krTitle")}</label>
            <Input autoFocus value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder={t("okr.f.krPlaceholder")} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.owner")}</label>
              <Select className="w-full" value={draft.ownerId} onValueChange={(v) => patch({ ownerId: v })} options={[{ value: "", label: t("okr.unassigned") }, ...members.map((m) => ({ value: m.id, label: m.name }))]} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.type")}</label>
              <Select
                className="w-full"
                value={draft.type}
                onValueChange={(v) => patch({ type: v as KeyResultType })}
                options={(["task_based", "numeric", "percentage", "manual"] as const).map((v) => ({ value: v, label: t(`okr.krType.${v}`) }))}
              />
            </div>
          </div>

          {draft.type === "task_based" && (
            <p className="text-[11px] text-neutral-400 -mt-1">{t("okr.f.taskBasedHint")}</p>
          )}

          {draft.type === "numeric" && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.startValue")}</label>
                <Input type="number" value={draft.startValue} onChange={(e) => patch({ startValue: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.currentValue")}</label>
                <Input type="number" value={draft.currentValue} onChange={(e) => patch({ currentValue: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.targetValue")}</label>
                <Input type="number" value={draft.targetValue} onChange={(e) => patch({ targetValue: Number(e.target.value) })} />
              </div>
            </div>
          )}
          {draft.type === "numeric" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.unit")}</label>
              <Input value={draft.unit} onChange={(e) => patch({ unit: e.target.value })} placeholder="e.g. days, $, tickets" className="w-32" data-testid="kr-unit" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.confidence")}</label>
              <Input type="number" min={0} max={100} value={draft.confidence} onChange={(e) => patch({ confidence: Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0))) })} data-testid="kr-confidence" />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.dueDate")}</label>
              <Input type="date" value={draft.dueDate} onChange={(e) => patch({ dueDate: e.target.value })} data-testid="kr-due" />
            </div>
          </div>

          {draft.type === "percentage" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.currentPct")}</label>
              <Input type="number" min={0} max={100} value={draft.currentValue} onChange={(e) => patch({ currentValue: Number(e.target.value) })} />
            </div>
          )}

          {draft.type === "manual" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.progressPct")}</label>
              <Input type="number" min={0} max={100} value={draft.manualProgress} onChange={(e) => patch({ manualProgress: Number(e.target.value) })} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.weight")}</label>
              <Input type="number" min={0} step={0.1} value={draft.weight} onChange={(e) => patch({ weight: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.status")}</label>
              <Select
                className="w-full"
                value={draft.status}
                onValueChange={(v) => patch({ status: v })}
                options={(["on_track", "at_risk", "off_track", "completed"] as const).map((v) => ({ value: v, label: t(`okr.status.${v}`) }))}
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => onSave(draft)} disabled={!draft.title.trim()}>{t("common.save")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
