"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import type { KeyResultRow, KeyResultType } from "@/types";

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
        <DialogTitle>{keyResult ? "Edit Key Result" : "New Key Result"}</DialogTitle>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">Key Result title</label>
            <Input autoFocus value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder="e.g. Reduce HR processing turnaround time by 30%" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Owner</label>
              <Select className="w-full" value={draft.ownerId} onValueChange={(v) => patch({ ownerId: v })} options={[{ value: "", label: "Unassigned" }, ...members.map((m) => ({ value: m.id, label: m.name }))]} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Type</label>
              <Select
                className="w-full"
                value={draft.type}
                onValueChange={(v) => patch({ type: v as KeyResultType })}
                options={[
                  { value: "task_based", label: "Task-based" },
                  { value: "numeric", label: "Numeric" },
                  { value: "percentage", label: "Percentage" },
                  { value: "manual", label: "Manual" },
                ]}
              />
            </div>
          </div>

          {draft.type === "task_based" && (
            <p className="text-[11px] text-neutral-400 -mt-1">Progress is computed automatically from linked tasks - add them from the Objective detail page after saving.</p>
          )}

          {draft.type === "numeric" && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">Start value</label>
                <Input type="number" value={draft.startValue} onChange={(e) => patch({ startValue: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">Current value</label>
                <Input type="number" value={draft.currentValue} onChange={(e) => patch({ currentValue: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">Target value</label>
                <Input type="number" value={draft.targetValue} onChange={(e) => patch({ targetValue: Number(e.target.value) })} />
              </div>
            </div>
          )}
          {draft.type === "numeric" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Unit (optional)</label>
              <Input value={draft.unit} onChange={(e) => patch({ unit: e.target.value })} placeholder="e.g. days, $, tickets" className="w-32" />
            </div>
          )}

          {draft.type === "percentage" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Current value (%)</label>
              <Input type="number" min={0} max={100} value={draft.currentValue} onChange={(e) => patch({ currentValue: Number(e.target.value) })} />
            </div>
          )}

          {draft.type === "manual" && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Progress (%)</label>
              <Input type="number" min={0} max={100} value={draft.manualProgress} onChange={(e) => patch({ manualProgress: Number(e.target.value) })} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Weight (in Objective)</label>
              <Input type="number" min={0} step={0.1} value={draft.weight} onChange={(e) => patch({ weight: Number(e.target.value) })} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Status</label>
              <Select
                className="w-full"
                value={draft.status}
                onValueChange={(v) => patch({ status: v })}
                options={[
                  { value: "on_track", label: "On Track" },
                  { value: "at_risk", label: "At Risk" },
                  { value: "off_track", label: "Off Track" },
                  { value: "completed", label: "Completed" },
                ]}
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onSave(draft)} disabled={!draft.title.trim()}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
