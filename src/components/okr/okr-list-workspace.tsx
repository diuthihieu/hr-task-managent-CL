"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Plus, MoreHorizontal, Pencil, Trash2, Target, KeySquare, CornerDownRight, FolderKanban, CheckSquare } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useT } from "@/components/i18n-provider";
import { ObjectiveDialog, objectivePayload, type ObjectiveDraft } from "./objective-dialog";
import { KeyResultDialog, type KeyResultDraft } from "./key-result-dialog";
import { ProgressBar, StatusBadge, PriorityBadge, ConfidenceDot, UserChip, UserStack, DeadlineLabel, CycleLabel } from "./okr-ui";
import type { KeyResultTaskRow, ObjectiveRow, TeamRow } from "@/types";

interface MemberLite {
  id: string;
  name: string;
}

type Scope = "team" | "mine" | "project";

/**
 * One list component for Team OKRs (every objective in the workspace, from
 * every project), My OKRs (objectives that involve the caller) and a
 * project's own Objectives tab.
 */
export function OkrListWorkspace({
  workspaceId,
  workspaceSlug,
  scope,
  projectId,
  projectName,
  canEdit = true,
}: {
  workspaceId: string;
  workspaceSlug: string;
  scope: Scope;
  projectId?: string;
  projectName?: string;
  canEdit?: boolean;
}) {
  const { t } = useT();
  const [objectives, setObjectives] = useState<ObjectiveRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ teamId: "", ownerId: "", status: "", cycleType: "", projectId: "" });
  const [groupBy, setGroupBy] = useState<"project" | "team">("project");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [objectiveDialog, setObjectiveDialog] = useState<{ open: boolean; objective: ObjectiveRow | null }>({ open: false, objective: null });
  const [keyResultDialog, setKeyResultDialog] = useState<{ open: boolean; objectiveId: string | null }>({ open: false, objectiveId: null });

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (scope === "mine") params.set("mine", "1");
      const pid = scope === "project" ? projectId : filters.projectId;
      if (pid) params.set("projectId", pid);
      if (filters.teamId) params.set("teamId", filters.teamId);
      if (filters.ownerId) params.set("ownerId", filters.ownerId);
      if (filters.status) params.set("status", filters.status);
      if (filters.cycleType) params.set("cycleType", filters.cycleType);
      const rows = await api.get<ObjectiveRow[]>(`/api/workspaces/${workspaceId}/objectives?${params}`);
      setObjectives(rows);
      if (scope === "project") setExpanded(new Set(rows.map((r) => r.id)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetching objectives on mount / filter change is exactly what this effect is for
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, projectId, filters.teamId, filters.ownerId, filters.status, filters.cycleType, filters.projectId]);

  useEffect(() => {
    api.get<TeamRow[]>(`/api/workspaces/${workspaceId}/teams`).then(setTeams).catch(() => {});
    api.get<MemberLite[]>(`/api/workspaces/${workspaceId}/members`).then(setMembers).catch(() => {});
    api.get<{ id: string; name: string }[]>(`/api/workspaces/${workspaceId}/projects`).then(setProjects).catch(() => {});
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
    const isNew = !objectiveDialog.objective;
    try {
      if (!isNew) await api.patch(`/api/objectives/${objectiveDialog.objective!.id}`, objectivePayload(draft, false));
      else await api.post(`/api/workspaces/${workspaceId}/objectives`, objectivePayload(draft, true));
      setObjectiveDialog({ open: false, objective: null });
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function deleteObjective(id: string) {
    if (!confirm(t("okr.deleteObjectiveConfirm"))) return;
    try {
      await api.delete(`/api/objectives/${id}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function deleteKeyResult(id: string) {
    if (!confirm(t("okr.deleteKrConfirm"))) return;
    try {
      await api.delete(`/api/key-results/${id}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
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
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  const grouped = useMemo(() => {
    if (scope !== "team") return [{ key: "__all__", name: "", color: null as string | null, objectives }];
    const map = new Map<string, { key: string; name: string; color: string | null; objectives: ObjectiveRow[] }>();
    for (const o of objectives) {
      const key = groupBy === "project" ? (o.project?.id ?? "__ws__") : (o.team?.id ?? "__none__");
      const name = groupBy === "project" ? (o.project?.name ?? t("okr.workspaceLevel")) : (o.team?.name ?? t("okr.noTeam"));
      const color = groupBy === "project" ? (o.project?.color ?? null) : (o.team?.color ?? null);
      if (!map.has(key)) map.set(key, { key, name, color, objectives: [] });
      map.get(key)!.objectives.push(o);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [objectives, scope, groupBy, t]);

  const title = scope === "mine" ? t("nav.myOkrs") : scope === "project" ? t("okr.projectTitle", { project: projectName ?? "" }) : t("nav.teamOkrs");
  const taskHref = (task: KeyResultTaskRow) => `/w/${workspaceSlug}/p/${task.projectId}/t/${task.taskId}`;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 min-h-12 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
        <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">{title}</h1>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {scope === "team" && (
            <Select className="w-32" value={groupBy} onValueChange={(v) => setGroupBy(v as "project" | "team")} options={[{ value: "project", label: `${t("okr.groupBy")}: ${t("okr.groupProject")}` }, { value: "team", label: `${t("okr.groupBy")}: ${t("okr.groupTeam")}` }]} />
          )}
          {scope !== "project" && (
            <Select className="w-32" value={filters.projectId} onValueChange={(v) => setFilters((f) => ({ ...f, projectId: v }))} options={[{ value: "", label: t("okr.allProjects") }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} />
          )}
          <Select className="w-28" value={filters.teamId} onValueChange={(v) => setFilters((f) => ({ ...f, teamId: v }))} options={[{ value: "", label: t("okr.allTeams") }, ...teams.map((tm) => ({ value: tm.id, label: tm.name }))]} />
          <Select className="w-28" value={filters.ownerId} onValueChange={(v) => setFilters((f) => ({ ...f, ownerId: v }))} options={[{ value: "", label: t("okr.allOwners") }, ...members.map((m) => ({ value: m.id, label: m.name }))]} />
          <Select
            className="w-28"
            value={filters.status}
            onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))}
            options={[{ value: "", label: t("okr.allStatus") }, ...(["not_started", "on_track", "at_risk", "off_track", "completed"] as const).map((v) => ({ value: v, label: t(`okr.status.${v}`) }))]}
          />
          <Select className="w-28" value={filters.cycleType} onValueChange={(v) => setFilters((f) => ({ ...f, cycleType: v }))} options={[{ value: "", label: t("okr.allCycles") }, ...(["quarter", "year", "custom"] as const).map((v) => ({ value: v, label: t(`okr.cycle.${v}`) }))]} />
          {canEdit && (
            <Button size="sm" onClick={() => setObjectiveDialog({ open: true, objective: null })} data-testid="okr-new-objective">
              <Plus size={13} /> {t("okr.newObjective")}
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll p-4 space-y-5">
        {scope === "project" && <p className="text-xs text-neutral-500 max-w-3xl">{t("okr.projectHint")}</p>}
        {loading && <div className="text-sm text-neutral-400">{t("common.loading")}</div>}
        {!loading && objectives.length === 0 && (
          <div className="text-center py-16 text-neutral-400">
            <Target size={28} className="mx-auto mb-3 opacity-40" />
            <p className="text-sm max-w-md mx-auto">{scope === "mine" ? t("okr.noMine") : t("okr.noObjectives")}</p>
          </div>
        )}
        {grouped.map((group) => (
          <div key={group.key}>
            {scope === "team" && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2 px-1">
                {groupBy === "project" && <FolderKanban size={12} style={{ color: group.color ?? undefined }} />}
                {group.name} <span className="text-neutral-300 dark:text-neutral-700">· {group.objectives.length}</span>
              </div>
            )}
            <div className="space-y-2">
              {group.objectives.map((o) => (
                <div key={o.id} className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden" data-testid={`objective-${o.id}`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 min-h-12">
                    <button onClick={() => toggle(o.id)} className="text-neutral-400 shrink-0" aria-label={t("common.open")}>
                      {expanded.has(o.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <div className="min-w-0 max-w-[340px]">
                      <Link href={`/w/${workspaceSlug}/okrs/${o.id}`} className="flex items-center gap-1.5 font-medium text-sm text-neutral-900 dark:text-neutral-100 hover:text-indigo-600 dark:hover:text-indigo-400">
                        <Target size={13} className="text-indigo-500 shrink-0" />
                        <span className="truncate">{o.title}</span>
                      </Link>
                      {o.parentKeyResult && (
                        <div className="flex items-center gap-1 text-[11px] text-neutral-400 truncate">
                          <CornerDownRight size={11} className="shrink-0" />
                          <Link href={`/w/${workspaceSlug}/okrs/${o.parentKeyResult.objectiveId}`} className="truncate hover:text-indigo-600">
                            {t("okr.alignedTo", { kr: o.parentKeyResult.title, objective: o.parentKeyResult.objectiveTitle })}
                          </Link>
                        </div>
                      )}
                      {scope !== "project" && o.project && <div className="text-[11px] text-neutral-400 truncate">{o.project.name}</div>}
                    </div>
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
                    {canEdit && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0" aria-label={t("common.more")}>
                            <MoreHorizontal size={15} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => setObjectiveDialog({ open: true, objective: o })}>
                            <Pencil size={13} /> {t("common.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => setKeyResultDialog({ open: true, objectiveId: o.id })}>
                            <Plus size={13} /> {t("okr.addKeyResult")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => deleteObjective(o.id)} className="text-red-600 dark:text-red-400">
                            <Trash2 size={13} /> {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                  {expanded.has(o.id) && (
                    <div className="border-t border-neutral-100 dark:border-neutral-800 px-3 py-2 space-y-1.5 bg-neutral-50/60 dark:bg-neutral-950/40">
                      {o.keyResults.length === 0 && <p className="text-xs text-neutral-400 py-1">{t("okr.noKeyResults")}</p>}
                      {o.keyResults.map((kr) => {
                        const children = o.childObjectives.filter((c) => c.parentKeyResultId === kr.id);
                        return (
                          <div key={kr.id} className="group/kr">
                            <div className="flex items-center gap-2 py-1 text-xs rounded-md px-1.5 -mx-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-900">
                              <KeySquare size={12} className="text-teal-500 shrink-0" />
                              <span className="text-neutral-700 dark:text-neutral-300 truncate flex-1">{kr.title}</span>
                              <span className="w-24 shrink-0 hidden sm:block">
                                <UserChip user={kr.owner} size={16} />
                              </span>
                              <span className="text-neutral-400 shrink-0">{t("okr.tasksLinked", { count: kr.tasks.length })}</span>
                              <div className="w-24 shrink-0">
                                <ProgressBar value={kr.progress} height={4} />
                              </div>
                              <span className="tabular-nums text-neutral-500 w-8 text-right shrink-0">{Math.round(kr.progress)}%</span>
                              {canEdit && (
                                <button onClick={() => deleteKeyResult(kr.id)} className="opacity-0 group-hover/kr:opacity-100 text-neutral-400 hover:text-red-600" aria-label={t("common.delete")}>
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </div>
                            {kr.tasks.length > 0 && scope === "project" && (
                              <div className="pl-6 space-y-0.5">
                                {kr.tasks.map((task) => (
                                  <Link key={task.id} href={taskHref(task)} className="flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-indigo-600 truncate">
                                    <CheckSquare size={10} className="shrink-0" /> <span className="truncate">{task.title}</span> <span className="text-neutral-400">· {Math.round(task.progress)}%</span>
                                  </Link>
                                ))}
                              </div>
                            )}
                            {children.map((c) => (
                              <Link key={c.id} href={`/w/${workspaceSlug}/okrs/${c.id}`} className="flex items-center gap-1.5 pl-6 py-0.5 text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline truncate">
                                <CornerDownRight size={11} className="shrink-0" /> <Target size={11} className="shrink-0" /> <span className="truncate">{c.title}</span>
                                {c.owner && <span className="text-neutral-400">· {c.owner.name}</span>}
                              </Link>
                            ))}
                          </div>
                        );
                      })}
                      {o.tasks.length > 0 && (
                        <div className="pt-1">
                          <div className="text-[11px] font-medium text-neutral-500 mb-0.5">{t("okr.directTasks")}</div>
                          {o.tasks.map((task) => (
                            <Link key={task.id} href={taskHref(task)} className="flex items-center gap-1.5 pl-1 text-[11px] text-neutral-500 hover:text-indigo-600 truncate">
                              <CheckSquare size={10} className="shrink-0" /> <span className="truncate">{task.title}</span>
                              <span className="text-neutral-400">
                                · {task.projectName} · {Math.round(task.progress)}%
                              </span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <ObjectiveDialog
        open={objectiveDialog.open}
        onOpenChange={(v) => setObjectiveDialog((d) => ({ ...d, open: v }))}
        objective={objectiveDialog.objective}
        teams={teams}
        members={members}
        onSave={saveObjective}
        workspaceId={workspaceId}
        projects={projects}
        fixedProjectId={scope === "project" ? (projectId ?? null) : null}
      />
      <KeyResultDialog open={keyResultDialog.open} onOpenChange={(v) => setKeyResultDialog((d) => ({ ...d, open: v }))} keyResult={null} members={members} onSave={saveKeyResult} />
    </div>
  );
}
