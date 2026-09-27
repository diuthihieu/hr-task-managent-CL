"use client";
import { useEffect, useState } from "react";
import { X, KeySquare } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
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
  projectId: string;
  parentKeyResultId: string;
  /** Only when creating: key results created together with the objective. */
  keyResults: string[];
}

interface OkrOptionsPayload {
  objectives: { id: string; title: string; projectName: string | null }[];
  keyResults: { id: string; title: string; objectiveId: string }[];
}

function toDraft(o: ObjectiveRow | null, projectId: string | null): ObjectiveDraft {
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
    projectId: o ? (o.projectId ?? "") : (projectId ?? ""),
    parentKeyResultId: o?.parentKeyResult?.id ?? "",
    keyResults: o ? [] : [""],
  };
}

/** Payload for POST/PATCH objective from a draft. */
export function objectivePayload(draft: ObjectiveDraft, isNew: boolean) {
  return {
    title: draft.title,
    description: draft.description || null,
    teamId: draft.teamId || null,
    ownerId: draft.ownerId || null,
    contributorIds: draft.contributorIds,
    cycleType: draft.cycleType,
    cycleLabel: draft.cycleLabel || null,
    startDate: draft.startDate || null,
    endDate: draft.endDate || null,
    status: draft.status,
    confidence: draft.confidence,
    priority: draft.priority,
    projectId: draft.projectId || null,
    parentKeyResultId: draft.parentKeyResultId || null,
    ...(isNew ? { keyResults: draft.keyResults.filter((k) => k.trim()).map((k) => ({ title: k.trim() })) } : {}),
  };
}

export function ObjectiveDialog({
  open,
  onOpenChange,
  objective,
  teams,
  members,
  onSave,
  workspaceId,
  projects,
  fixedProjectId = null,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  objective: ObjectiveRow | null;
  teams: TeamRow[];
  members: { id: string; name: string }[];
  onSave: (draft: ObjectiveDraft) => void;
  workspaceId?: string;
  projects?: { id: string; name: string }[];
  /** When set, the objective belongs to this project and the project picker is hidden. */
  fixedProjectId?: string | null;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState<ObjectiveDraft>(() => toDraft(objective, fixedProjectId));
  const [wasOpen, setWasOpen] = useState(false);
  const [options, setOptions] = useState<OkrOptionsPayload>({ objectives: [], keyResults: [] });
  if (open && !wasOpen) {
    setWasOpen(true);
    setDraft(toDraft(objective, fixedProjectId));
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  useEffect(() => {
    if (!open || !workspaceId) return;
    api.get<OkrOptionsPayload>(`/api/workspaces/${workspaceId}/okr-options`).then(setOptions).catch(() => {});
  }, [open, workspaceId]);

  function patch(p: Partial<ObjectiveDraft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  const statusOptions = (["not_started", "on_track", "at_risk", "off_track", "completed"] as const).map((v) => ({ value: v, label: t(`okr.status.${v}`) }));
  const priorityOptions = (["low", "medium", "high", "critical"] as const).map((v) => ({ value: v, label: t(`okr.priority.${v}`) }));
  const cycleOptions = (["quarter", "year", "custom"] as const).map((v) => ({ value: v, label: t(`okr.cycle.${v}`) }));
  // A key result of any *other* objective can be the parent of this one.
  const parentOptions = options.objectives
    .filter((o) => o.id !== objective?.id)
    .flatMap((o) =>
      options.keyResults
        .filter((k) => k.objectiveId === o.id)
        .map((k) => ({ value: k.id, label: `${k.title} — ${o.title}${o.projectName ? ` (${o.projectName})` : ""}` }))
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{objective ? t("okr.editObjective") : t("okr.newObjective")}</DialogTitle>
        <div className="space-y-3 max-h-[70vh] overflow-y-auto thin-scroll pr-1">
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.title")}</label>
            <Input autoFocus value={draft.title} onChange={(e) => patch({ title: e.target.value })} placeholder={t("okr.f.titlePlaceholder")} data-testid="objective-title" />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.description")}</label>
            <Textarea rows={2} value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
          </div>

          {!objective && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.keyResults")}</label>
              <div className="space-y-1.5">
                {draft.keyResults.map((k, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <KeySquare size={13} className="text-teal-500 shrink-0" />
                    <Input value={k} onChange={(e) => patch({ keyResults: draft.keyResults.map((x, xi) => (xi === i ? e.target.value : x)) })} placeholder={t("okr.f.krPlaceholder")} data-testid={`objective-kr-${i}`} />
                    <button onClick={() => patch({ keyResults: draft.keyResults.filter((_, xi) => xi !== i) })} className="text-neutral-400 hover:text-red-600" aria-label={t("common.remove")}>
                      <X size={13} />
                    </button>
                  </div>
                ))}
                <button onClick={() => patch({ keyResults: [...draft.keyResults, ""] })} className="text-xs text-indigo-600 hover:underline">
                  {t("project.new.addKr")}
                </button>
              </div>
            </div>
          )}

          {!fixedProjectId && projects && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.project")}</label>
              <Select className="w-full" value={draft.projectId} onValueChange={(v) => patch({ projectId: v })} options={[{ value: "", label: t("okr.workspaceLevel") }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
            </div>
          )}

          {workspaceId && (
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.parentKr")}</label>
              <Select className="w-full" value={draft.parentKeyResultId} onValueChange={(v) => patch({ parentKeyResultId: v })} options={[{ value: "", label: t("okr.parentKrNone") }, ...parentOptions]} />
              <p className="text-[11px] text-neutral-400 mt-1">{t("okr.cascadeHint")}</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.team")}</label>
              <Select className="w-full" value={draft.teamId} onValueChange={(v) => patch({ teamId: v })} options={[{ value: "", label: t("okr.noTeam") }, ...teams.map((tm) => ({ value: tm.id, label: tm.name }))]} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.owner")}</label>
              <Select className="w-full" value={draft.ownerId} onValueChange={(v) => patch({ ownerId: v })} options={[{ value: "", label: t("okr.unassigned") }, ...members.map((m) => ({ value: m.id, label: m.name }))]} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.contributors")}</label>
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
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.cycle")}</label>
              <Select className="w-full" value={draft.cycleType} onValueChange={(v) => patch({ cycleType: v as OkrCycleType })} options={cycleOptions} />
            </div>
            <div className="col-span-2">
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.cycleLabel")}</label>
              <Input value={draft.cycleLabel} onChange={(e) => patch({ cycleLabel: e.target.value })} placeholder="Q1 2026" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.start")}</label>
              <Input type="date" value={draft.startDate} onChange={(e) => patch({ startDate: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.end")}</label>
              <Input type="date" value={draft.endDate} onChange={(e) => patch({ endDate: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.status")}</label>
              <Select className="w-full" value={draft.status} onValueChange={(v) => patch({ status: v as ObjectiveStatus })} options={statusOptions} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.priority")}</label>
              <Select className="w-full" value={draft.priority} onValueChange={(v) => patch({ priority: v as OkrPriority })} options={priorityOptions} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("okr.f.confidence")}</label>
              <Input type="number" min={0} max={100} value={draft.confidence} onChange={(e) => patch({ confidence: Number(e.target.value) })} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={() => onSave(draft)} disabled={!draft.title.trim()} data-testid="objective-save">{t("common.save")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
