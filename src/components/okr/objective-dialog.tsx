"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import type { ObjectiveRow, OkrCycleType, ObjectiveStatus, OkrPriority, TeamRow } from "@/types";

export interface ObjectiveDraft {
  title: string;
  description: string;
  teamId: string;
  ownerId: string;
  contributorIds: string[];
  cycleType: OkrCycleType;
  cycleLabel: string;
  startDate: string;
  endDate: string;
  status: ObjectiveStatus;
  confidence: number;
  priority: OkrPriority;
}

function toDraft(o: ObjectiveRow | null): ObjectiveDraft {
  return {
    title: o?.title ?? "",
    description: o?.description ?? "",
    teamId: o?.teamId ?? "",
    ownerId: o?.owner?.id ?? "",
    contributorIds: o?.contributors.map((c) => c.id) ?? [],
    cycleType: o?.cycleType ?? "quarter",
    cycleLabel: o?.cycleLabel ?? "",
    startDate: o?.startDate ? o.startDate.slice(0, 10) : "",
    endDate: o?.endDate ? o.endDate.slice(0, 10) : "",
    status: o?.status ?? "not_started",
    confidence: o?.confidence ?? 70,
    priority: o?.priority ?? "medium",
  };
}

export function ObjectiveDialog({
  open,
  onOpenChange,
  objective,
  teams,
  members,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  objective: ObjectiveRow | null;
  teams: TeamRow[];
  members: { id: string; name: string }[];
  onSave: (draft: ObjectiveDraft) => void;
}) {
  const [draft, setDraft] = useState<ObjectiveDraft>(() => toDraft(objective));
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setDraft(toDraft(objective));
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  function patch(p: Partial<ObjectiveDraft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{objective ? "Edit Objective" : "New Objective"}</DialogTitle>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto thin-scroll pr-1">
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">Objective title</label>
            <Input autoFocus value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder="e.g. Improve HR Operational Excellence" />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">Description</label>
            <Textarea rows={2} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Team</label>
              <Select className="w-full" value={draft.teamId} onValueChange={(v) => patch({ teamId: v })} options={[{ value: "", label: "No team" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Owner</label>
              <Select className="w-full" value={draft.ownerId} onValueChange={(v) => patch({ ownerId: v })} options={[{ value: "", label: "Unassigned" }, ...members.map((m) => ({ value: m.id, label: m.name }))]} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">Contributors</label>
            <div className="max-h-24 overflow-y-auto thin-scroll border border-neutral-200 dark:border-neutral-800 rounded-md p-1.5 space-y-1">
              {members.map((m) => {
                const checked = draft.contributorIds.includes(m.id);
                return (
                  <label key={m.id} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => patch({ contributorIds: e.target.checked ? [...draft.contributorIds, m.id] : draft.contributorIds.filter((id) => id !== m.id) })}
                    />
                    {m.name}
                  </label>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Cycle</label>
              <Select className="w-full" value={draft.cycleType} onValueChange={(v) => patch({ cycleType: v as OkrCycleType })} options={[{ value: "quarter", label: "Quarter" }, { value: "year", label: "Year" }, { value: "custom", label: "Custom" }]} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Cycle label</label>
              <Input value={draft.cycleLabel} onChange={(e) => patch({ cycleLabel: e.target.value })} placeholder="e.g. Q1 2026" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Start date</label>
              <Input type="date" value={draft.startDate} onChange={(e) => patch({ startDate: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">End date</label>
              <Input type="date" value={draft.endDate} onChange={(e) => patch({ endDate: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Status</label>
              <Select
                className="w-full"
                value={draft.status}
                onValueChange={(v) => patch({ status: v as ObjectiveStatus })}
                options={[
                  { value: "not_started", label: "Not Started" },
                  { value: "on_track", label: "On Track" },
                  { value: "at_risk", label: "At Risk" },
                  { value: "off_track", label: "Off Track" },
                  { value: "completed", label: "Completed" },
                ]}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Priority</label>
              <Select
                className="w-full"
                value={draft.priority}
                onValueChange={(v) => patch({ priority: v as OkrPriority })}
                options={[
                  { value: "low", label: "Low" },
                  { value: "medium", label: "Medium" },
                  { value: "high", label: "High" },
                  { value: "critical", label: "Critical" },
                ]}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Confidence %</label>
              <Input type="number" min={0} max={100} value={draft.confidence} onChange={(e) => patch({ confidence: Number(e.target.value) })} />
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
