"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Plus, MoreHorizontal, Pencil, Trash2, Target } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { ObjectiveDialog, type ObjectiveDraft } from "./objective-dialog";
import { KeyResultDialog, type KeyResultDraft } from "./key-result-dialog";
import { ProgressBar, StatusBadge, PriorityBadge, ConfidenceDot, UserChip, UserStack, DeadlineLabel, CycleLabel } from "./okr-ui";
import type { ObjectiveRow, TeamRow } from "@/types";

interface MemberLite {
  id: string;
  name: string;
}

export function OkrListWorkspace({ workspaceId, workspaceSlug, scope }: { workspaceId: string; workspaceSlug: string; scope: "team" | "mine" }) {
  const [objectives, setObjectives] = useState<ObjectiveRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<{ teamId: string; ownerId: string; status: string; cycleType: string }>({ teamId: "", ownerId: "", status: "", cycleType: "" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [objectiveDialog, setObjectiveDialog] = useState<{ open: boolean; objective: ObjectiveRow | null }>({ open: false, objective: null });
  const [keyResultDialog, setKeyResultDialog] = useState<{ open: boolean; objectiveId: string | null }>({ open: false, objectiveId: null });

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (scope === "mine") params.set("mine", "1");
      if (filters.teamId) params.set("teamId", filters.teamId);
      if (filters.ownerId) params.set("ownerId", filters.ownerId);
      if (filters.status) params.set("status", filters.status);
      if (filters.cycleType) params.set("cycleType", filters.cycleType);
      const rows = await api.get<ObjectiveRow[]>(`/api/workspaces/${workspaceId}/objectives?${params}`);
      setObjectives(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load OKRs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching objectives on mount / filter change is exactly what this effect is for
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, filters.teamId, filters.ownerId, filters.status, filters.cycleType]);

  useEffect(() => {
    api.get<TeamRow[]>(`/api/workspaces/${workspaceId}/teams`).then(setTeams).catch(() => {});
    api.get<MemberLite[]>(`/api/workspaces/${workspaceId}/members`).then(setMembers).catch(() => {});
  }, [workspaceId]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function saveObjective(draft: ObjectiveDraft) {
    const payload = {
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
    };
    try {
      if (objectiveDialog.objective) {
        await api.patch(`/api/objectives/${objectiveDialog.objective.id}`, payload);
      } else {
        await api.post(`/api/workspaces/${workspaceId}/objectives`, payload);
      }
      setObjectiveDialog({ open: false, objective: null });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save objective");
    }
  }

  async function deleteObjective(id: string) {
    if (!confirm("Delete this Objective and all its Key Results?")) return;
    try {
      await api.delete(`/api/objectives/${id}`);
      load();
    } catch {
      toast.error("Failed to delete objective");
    }
  }

  async function saveKeyResult(draft: KeyResultDraft) {
    if (!keyResultDialog.objectiveId) return;
    try {
      await api.post(`/api/objectives/${keyResultDialog.objectiveId}/key-results`, {
        title: draft.title,
        ownerId: draft.ownerId || null,
        type: draft.type,
        startValue: draft.startValue,
        targetValue: draft.targetValue,
        currentValue: draft.currentValue,
        unit: draft.unit || null,
        weight: draft.weight,
        manualProgress: draft.type === "manual" ? draft.manualProgress : null,
        status: draft.status,
      });
      setKeyResultDialog({ open: false, objectiveId: null });
      setExpanded((prev) => new Set(prev).add(keyResultDialog.objectiveId!));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add key result");
    }
  }

  const grouped = useMemo(() => {
    if (scope === "mine") return [{ key: "__mine__", name: "", objectives }];
    const map = new Map<string, { key: string; name: string; objectives: ObjectiveRow[] }>();
    for (const o of objectives) {
      const key = o.team?.id ?? "__none__";
      const name = o.team?.name ?? "No Team";
      if (!map.has(key)) map.set(key, { key, name, objectives: [] });
      map.get(key)!.objectives.push(o);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [objectives, scope]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
        <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{scope === "mine" ? "My OKRs" : "Team OKRs"}</h1>
        <div className="ml-auto flex items-center gap-1.5">
          <Select className="w-32" value={filters.teamId} onValueChange={(v) => setFilters((f) => ({ ...f, teamId: v }))} options={[{ value: "", label: "All teams" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]} />
          <Select className="w-32" value={filters.ownerId} onValueChange={(v) => setFilters((f) => ({ ...f, ownerId: v }))} options={[{ value: "", label: "All owners" }, ...members.map((m) => ({ value: m.id, label: m.name }))]} />
          <Select
            className="w-28"
            value={filters.status}
            onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={[
              { value: "", label: "All status" },
              { value: "not_started", label: "Not Started" },
              { value: "on_track", label: "On Track" },
              { value: "at_risk", label: "At Risk" },
              { value: "off_track", label: "Off Track" },
              { value: "completed", label: "Completed" },
            ]}
          />
          <Select className="w-28" value={filters.cycleType} onValueChange={(v) => setFilters((f) => ({ ...f, cycleType: v }))} options={[{ value: "", label: "All cycles" }, { value: "quarter", label: "Quarter" }, { value: "year", label: "Year" }, { value: "custom", label: "Custom" }]} />
          <Button size="sm" onClick={() => setObjectiveDialog({ open: true, objective: null })}>
            <Plus size={13} /> New Objective
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll p-4 space-y-5">
        {loading && <div className="text-sm text-neutral-400">Loading…</div>}
        {!loading && objectives.length === 0 && (
          <div className="text-center py-16 text-neutral-400">
            <Target size={28} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm">{scope === "mine" ? "No OKRs assigned to you yet." : "No Objectives yet."}</p>
          </div>
        )}
        {grouped.map((group) => (
          <div key={group.key}>
            {scope === "team" && (
              <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2 px-1">
                {group.name} <span className="text-neutral-300 dark:text-neutral-700">· {group.objectives.length}</span>
              </div>
            )}
            <div className="space-y-2">
              {group.objectives.map((o) => (
                <div key={o.id} className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
                  <div className="flex items-center gap-3 px-3 h-12">
                    <button onClick={() => toggle(o.id)} className="text-neutral-400 shrink-0">
                      {expanded.has(o.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <Link href={`/w/${workspaceSlug}/okrs/${o.id}`} className="font-medium text-sm text-neutral-900 dark:text-neutral-100 truncate hover:text-indigo-600 dark:hover:text-indigo-400 min-w-0 max-w-[280px]">
                      {o.title}
                    </Link>
                    <PriorityBadge priority={o.priority} />
                    <CycleLabel cycleType={o.cycleType} cycleLabel={o.cycleLabel} />
                    <div className="flex items-center gap-2 flex-1 min-w-[100px]">
                      <ProgressBar value={o.progress} />
                      <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300 tabular-nums w-9 text-right shrink-0">{Math.round(o.progress)}%</span>
                    </div>
                    <ConfidenceDot confidence={o.confidence} />
                    <StatusBadge status={o.status} />
                    <div className="w-28 shrink-0">
                      <UserChip user={o.owner} />
                    </div>
                    <UserStack users={o.contributors} />
                    <div className="w-20 text-right shrink-0">
                      <DeadlineLabel endDate={o.endDate} />
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0">
                          <MoreHorizontal size={15} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onSelect={() => setObjectiveDialog({ open: true, objective: o })}>
                          <Pencil size={13} /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setKeyResultDialog({ open: true, objectiveId: o.id })}>
                          <Plus size={13} /> Add Key Result
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => deleteObjective(o.id)} className="text-red-600 dark:text-red-400">
                          <Trash2 size={13} /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {expanded.has(o.id) && (
                    <div className="border-t border-neutral-100 dark:border-neutral-800 px-3 py-2 space-y-1.5 bg-neutral-50/60 dark:bg-neutral-950/40">
                      {o.keyResults.length === 0 && <p className="text-xs text-neutral-400 py-1">No Key Results yet.</p>}
                      {o.keyResults.map((kr) => (
                        <Link key={kr.id} href={`/w/${workspaceSlug}/okrs/${o.id}`} className="flex items-center gap-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-900 rounded-md px-1.5 -mx-1.5">
                          <span className="text-neutral-600 dark:text-neutral-300 truncate flex-1">{kr.title}</span>
                          <span className="text-neutral-400 shrink-0">{kr.tasks.length} task{kr.tasks.length === 1 ? "" : "s"}</span>
                          <div className="w-24 shrink-0">
                            <ProgressBar value={kr.progress} height={4} />
                          </div>
                          <span className="tabular-nums text-neutral-500 w-8 text-right shrink-0">{Math.round(kr.progress)}%</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <ObjectiveDialog open={objectiveDialog.open} onOpenChange={(v) => setObjectiveDialog((d) => ({ ...d, open: v }))} objective={objectiveDialog.objective} teams={teams} members={members} onSave={saveObjective} />
      <KeyResultDialog open={keyResultDialog.open} onOpenChange={(v) => setKeyResultDialog((d) => ({ ...d, open: v }))} keyResult={null} members={members} onSave={saveKeyResult} />
    </div>
  );
}
