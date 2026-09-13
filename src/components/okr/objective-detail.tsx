"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight, Plus, Search, X, Pencil, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ObjectiveDialog, type ObjectiveDraft } from "./objective-dialog";
import { KeyResultDialog, type KeyResultDraft } from "./key-result-dialog";
import { ProgressBar, StatusBadge, PriorityBadge, ConfidenceDot, UserChip, UserStack, DeadlineLabel, CycleLabel } from "./okr-ui";
import type { ObjectiveRow, KeyResultRow, TeamRow } from "@/types";

interface MemberLite {
  id: string;
  name: string;
}
interface TaskCandidate {
  tableId: string;
  tableName: string;
  baseName: string;
  recordId: string;
  title: string;
}

export function ObjectiveDetail({ objectiveId, workspaceId, workspaceSlug }: { objectiveId: string; workspaceId: string; workspaceSlug: string }) {
  const router = useRouter();
  const [objective, setObjective] = useState<ObjectiveRow | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editOpen, setEditOpen] = useState(false);
  const [krDialog, setKrDialog] = useState<{ open: boolean; kr: KeyResultRow | null }>({ open: false, kr: null });

  async function load() {
    try {
      const o = await api.get<ObjectiveRow>(`/api/objectives/${objectiveId}`);
      setObjective(o);
      setExpanded(new Set(o.keyResults.map((k) => k.id)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load objective");
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching objective data on mount / id change is exactly what this effect is for
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectiveId]);

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
    try {
      await api.patch(`/api/objectives/${objectiveId}`, {
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
      });
      setEditOpen(false);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save objective");
    }
  }

  async function saveKeyResult(draft: KeyResultDraft) {
    try {
      if (krDialog.kr) {
        await api.patch(`/api/key-results/${krDialog.kr.id}`, {
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
      } else {
        await api.post(`/api/objectives/${objectiveId}/key-results`, {
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
      }
      setKrDialog({ open: false, kr: null });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save key result");
    }
  }

  async function deleteKeyResult(id: string) {
    if (!confirm("Delete this Key Result?")) return;
    try {
      await api.delete(`/api/key-results/${id}`);
      load();
    } catch {
      toast.error("Failed to delete key result");
    }
  }

  async function unlinkTask(keyResultId: string, linkId: string) {
    try {
      await api.delete(`/api/key-results/${keyResultId}/tasks/${linkId}`);
      load();
    } catch {
      toast.error("Failed to unlink task");
    }
  }

  if (!objective) return <div className="flex-1 flex items-center justify-center text-sm text-neutral-400">Loading…</div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
        <button onClick={() => router.push(`/w/${workspaceSlug}/okrs`)} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
          <ArrowLeft size={16} />
        </button>
        <span className="text-sm font-medium text-neutral-500 truncate">{objective.team?.name ?? "No Team"}</span>
        <ChevronRight size={13} className="text-neutral-300" />
        <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 truncate">{objective.title}</span>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setEditOpen(true)}>
          <Pencil size={13} /> Edit
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll p-5 max-w-3xl w-full mx-auto space-y-5">
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">{objective.title}</h1>
              {objective.description && <p className="text-sm text-neutral-500 mt-1">{objective.description}</p>}
            </div>
            <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400 shrink-0 tabular-nums">{Math.round(objective.progress)}%</div>
          </div>
          <ProgressBar value={objective.progress} height={8} />
          <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
            <StatusBadge status={objective.status} />
            <PriorityBadge priority={objective.priority} />
            <ConfidenceDot confidence={objective.confidence} />
            <CycleLabel cycleType={objective.cycleType} cycleLabel={objective.cycleLabel} />
            <DeadlineLabel endDate={objective.endDate} />
            <UserChip user={objective.owner} />
            <UserStack users={objective.contributors} />
          </div>
        </div>

        <div className="flex items-center justify-between px-0.5">
          <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-200">Key Results</h2>
          <Button size="sm" onClick={() => setKrDialog({ open: true, kr: null })}>
            <Plus size={13} /> Add Key Result
          </Button>
        </div>

        <div className="space-y-2.5">
          {objective.keyResults.length === 0 && <p className="text-sm text-neutral-400 py-6 text-center">No Key Results yet.</p>}
          {objective.keyResults.map((kr) => (
            <div key={kr.id} className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden">
              <div className="flex items-center gap-2.5 px-3 h-11">
                <button onClick={() => toggle(kr.id)} className="text-neutral-400 shrink-0">
                  {expanded.has(kr.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate flex-1 min-w-[120px]">{kr.title}</span>
                <span className="text-[10px] uppercase tracking-wide text-neutral-400 shrink-0">{kr.type.replace("_", " ")}</span>
                <div className="w-32 shrink-0">
                  <ProgressBar value={kr.progress} />
                </div>
                <span className="text-xs font-medium tabular-nums w-9 text-right shrink-0">{Math.round(kr.progress)}%</span>
                <StatusBadge status={kr.status} />
                <div className="w-24 shrink-0">
                  <UserChip user={kr.owner} size={16} />
                </div>
                <button onClick={() => setKrDialog({ open: true, kr })} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0">
                  <Pencil size={12} />
                </button>
                <button onClick={() => deleteKeyResult(kr.id)} className="text-neutral-400 hover:text-red-600 shrink-0">
                  <X size={13} />
                </button>
              </div>
              {expanded.has(kr.id) && (
                <div className="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-950/40 px-3 py-2">
                  {kr.type !== "task_based" ? (
                    <p className="text-xs text-neutral-400 py-1">
                      {kr.type === "numeric" && `${kr.currentValue}${kr.unit ? ` ${kr.unit}` : ""} of ${kr.targetValue}${kr.unit ? ` ${kr.unit}` : ""} target`}
                      {kr.type === "percentage" && `${kr.currentValue}% complete`}
                      {kr.type === "manual" && `Manually set to ${kr.manualProgress ?? 0}%`}
                    </p>
                  ) : (
                    <>
                      {kr.tasks.length === 0 && <p className="text-xs text-neutral-400 py-1">No tasks linked yet.</p>}
                      <div className="space-y-1">
                        {kr.tasks.map((t) => (
                          <div key={t.id} className="flex items-center gap-2 py-1 group/task">
                            <Link
                              href={`/w/${workspaceSlug}/b/${t.baseId}/t/${t.tableId}?record=${t.recordId}`}
                              className="flex-1 min-w-0 flex items-center gap-1.5 text-xs text-neutral-700 dark:text-neutral-300 hover:text-indigo-600 dark:hover:text-indigo-400"
                            >
                              <ExternalLink size={11} className="shrink-0 opacity-0 group-hover/task:opacity-100" />
                              <span className="truncate">{t.title || "(untitled)"}</span>
                            </Link>
                            {t.status && <span className="text-[10px] text-neutral-400 shrink-0">{t.status}</span>}
                            <div className="w-16 shrink-0">
                              <ProgressBar value={t.progress} height={4} />
                            </div>
                            <span className="text-[10px] tabular-nums text-neutral-400 w-8 text-right shrink-0">{t.progress}%</span>
                            <span className="text-[10px] text-neutral-300 dark:text-neutral-700 w-10 text-right shrink-0">{t.weight}×</span>
                            <button onClick={() => unlinkTask(kr.id, t.id)} className="text-neutral-300 hover:text-red-600 shrink-0">
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <LinkTaskPopover keyResultId={kr.id} onLinked={load} />
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <ObjectiveDialog open={editOpen} onOpenChange={setEditOpen} objective={objective} teams={teams} members={members} onSave={saveObjective} />
      <KeyResultDialog open={krDialog.open} onOpenChange={(v) => setKrDialog((d) => ({ ...d, open: v }))} keyResult={krDialog.kr} members={members} onSave={saveKeyResult} />
    </div>
  );
}

function LinkTaskPopover({ keyResultId, onLinked }: { keyResultId: string; onLinked: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TaskCandidate[]>([]);
  const [loading, setLoading] = useState(false);

  async function search(q: string) {
    setQuery(q);
    setLoading(true);
    try {
      const rows = await api.get<TaskCandidate[]>(`/api/key-results/${keyResultId}/tasks?q=${encodeURIComponent(q)}`);
      setResults(rows);
    } finally {
      setLoading(false);
    }
  }

  async function link(candidate: TaskCandidate) {
    try {
      await api.post(`/api/key-results/${keyResultId}/tasks`, { tableId: candidate.tableId, recordId: candidate.recordId });
      onLinked();
    } catch {
      toast.error("Failed to link task");
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button onClick={() => search("")} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline mt-1.5">
          <Plus size={12} /> Link a task
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2">
        <div className="flex items-center gap-1.5 mb-2">
          <Search size={13} className="text-neutral-400 shrink-0" />
          <Input autoFocus value={query} onChange={(e) => search(e.target.value)} placeholder="Search tasks across all tables…" className="h-7 flex-1" />
        </div>
        <div className="max-h-56 overflow-y-auto thin-scroll space-y-0.5">
          {loading && <div className="text-xs text-neutral-400 px-2 py-2">Searching…</div>}
          {!loading && results.length === 0 && <div className="text-xs text-neutral-400 px-2 py-2">No matching tasks</div>}
          {results.map((r) => (
            <button key={`${r.tableId}-${r.recordId}`} onClick={() => link(r)} className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-left">
              <span className="flex-1 truncate text-sm">{r.title || "(untitled)"}</span>
              <span className="text-[10px] text-neutral-400 shrink-0">{r.tableName}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
