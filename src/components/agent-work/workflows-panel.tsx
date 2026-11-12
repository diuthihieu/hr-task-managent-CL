"use client";
// Agent Work → Workflows: Skills that run on a schedule for me; results arrive in my Woli AI inbox.
// Describe it in words (AI fills the form) or set it up by hand.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarClock, Loader2, Pause, Pencil, Play, Plus, Sparkles, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { MessageKey } from "@/lib/i18n/core";
import type { WorkflowSchedule } from "@/lib/agent-work/schedule";
import { ParamFields, collectArgs, initialParamState, skillParams, type ParamRanges, type ParamValues } from "./skill-command-parts";

interface SkillLite {
  id: string;
  name: string;
  command: string | null;
  parameters: unknown;
}
interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  skillId: string;
  args: Record<string, unknown>;
  note: string | null;
  schedule: WorkflowSchedule;
  active: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastStatus: string | null;
  lastError: string | null;
  failureCount: number;
  skill: { name: string; deletedAt: string | null };
}
interface Draft {
  skillId: string | null;
  name: string;
  args: Record<string, unknown>;
  note: string | null;
  schedule: WorkflowSchedule;
  missingSkill: string | null;
  description: string;
}

const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
const field = "h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-xs";
const pad = (n: number) => String(n).padStart(2, "0");
const DEFAULT_SCHEDULE: WorkflowSchedule = { freq: "weekly", minute: 0, hour: 8, weekdays: [0], monthDay: 1 };

export function useScheduleText() {
  const { t } = useT();
  return useCallback(
    (s: WorkflowSchedule) => {
      const time = `${pad(s.hour)}:${pad(s.minute)}`;
      if (s.freq === "hourly") return t("wf.every.hour", { minute: pad(s.minute) });
      if (s.freq === "daily") return t("wf.every.day", { time });
      if (s.freq === "weekly") return t("wf.every.week", { days: s.weekdays.map((d) => t(`wf.day.${d}` as MessageKey)).join(", "), time });
      return t(s.monthDay === 31 ? "wf.every.monthLast" : "wf.every.month", { day: s.monthDay, time });
    },
    [t],
  );
}

const vnTime = (iso: string) => new Date(iso).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function WorkflowsPanel({ workspaceId, skills, onOpenSkills }: { workspaceId: string; skills: SkillLite[]; onOpenSkills: () => void }) {
  const { t } = useT();
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const scheduleText = useScheduleText();
  const [rows, setRows] = useState<WorkflowRow[] | null>(null);
  const [editing, setEditing] = useState<WorkflowRow | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get<WorkflowRow[]>(`/api/workspaces/${workspaceId}/agent-work/workflows`).then(setRows).catch((e) => toast.error(e instanceof Error ? e.message : t("common.failed")));
  }, [workspaceId, t]);
  useEffect(() => load(), [load]);

  async function act(id: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(id);
    try {
      await fn();
      if (done) toast.success(done);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-3" data-testid="workflows-panel">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">{t("wf.title")}</h2>
          <p className="text-xs text-neutral-500">{t("wf.hint")}</p>
        </div>
        <Button onClick={() => setEditing("new")} data-testid="wf-new"><Plus size={14} /> {t("wf.new")}</Button>
      </div>
      {rows === null ? (
        <div className="py-8 flex justify-center text-neutral-400"><Loader2 className="animate-spin" size={18} /></div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-6 text-center text-sm text-neutral-500">{t("wf.empty")}</div>
      ) : (
        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-200 dark:divide-neutral-800">
          {rows.map((w) => (
            <div key={w.id} className="p-3 flex flex-col sm:flex-row sm:items-center gap-3" data-testid="wf-row">
              <span className="h-9 w-9 rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-600 flex items-center justify-center shrink-0"><CalendarClock size={16} /></span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{w.name}</p>
                <p className="text-[11px] text-neutral-500 flex flex-wrap gap-x-3">
                  <span data-testid="wf-schedule">{scheduleText(w.schedule)}</span>
                  <span>{w.skill.name}</span>
                  {w.active && <span>{t("wf.next", { at: vnTime(w.nextRunAt) })}</span>}
                </p>
                {w.lastStatus && (
                  <p className={`text-[11px] ${w.lastStatus === "failed" ? "text-rose-600" : w.lastStatus === "waiting_approval" ? "text-amber-600" : "text-emerald-600"}`} data-testid="wf-last">
                    {t(`wf.last.${w.lastStatus}` as MessageKey, { at: w.lastRunAt ? vnTime(w.lastRunAt) : "" })}
                    {w.lastError ? ` - ${w.lastError}` : ""}
                    {w.lastRunId && w.lastStatus !== "failed" && <> - <Link className="underline" href={`/w/${workspaceSlug}/agent-work?run=${w.lastRunId}`}>{t("cmd.openRun")}</Link></>}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="flex items-center gap-1.5 text-[11px] text-neutral-500" title={t(w.active ? "wf.pause" : "wf.resume")}>
                  {w.active ? <Play size={12} /> : <Pause size={12} />}
                  <Switch checked={w.active} onCheckedChange={(v) => void act(w.id, () => api.patch(`/api/agent-work/workflows/${w.id}`, { active: v }))} />
                </span>
                <Button size="sm" variant="outline" disabled={busy === w.id} onClick={() => void act(w.id, () => api.post(`/api/agent-work/workflows/${w.id}/run`), t("wf.ranNow"))} data-testid="wf-run-now">
                  {busy === w.id ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} {t("wf.runNow")}
                </Button>
                <Button size="icon" variant="ghost" aria-label={t("common.edit")} onClick={() => setEditing(w)}><Pencil size={14} /></Button>
                <Button size="icon" variant="ghost" aria-label={t("common.delete")} onClick={() => confirm(t("wf.deleteConfirm")) && void act(w.id, () => api.delete(`/api/agent-work/workflows/${w.id}`))} data-testid="wf-delete"><Trash2 size={14} /></Button>
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-neutral-400">{t("wf.footer")}</p>
      {editing && <WorkflowDialog workspaceId={workspaceId} skills={skills} existing={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} onOpenSkills={onOpenSkills} />}
    </section>
  );
}

function WorkflowDialog({ workspaceId, skills, existing, onClose, onSaved, onOpenSkills }: { workspaceId: string; skills: SkillLite[]; existing: WorkflowRow | null; onClose: () => void; onSaved: () => void; onOpenSkills: () => void }) {
  const { t } = useT();
  const scheduleText = useScheduleText();
  const [step, setStep] = useState<"describe" | "form">(existing ? "form" : "describe");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [drafting, setDrafting] = useState(false);
  const [missing, setMissing] = useState<string | null>(null);
  const [name, setName] = useState(existing?.name ?? "");
  const [skillId, setSkillId] = useState(existing?.skillId ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [schedule, setSchedule] = useState<WorkflowSchedule>(existing?.schedule ?? DEFAULT_SCHEDULE);
  const [saved, setSavedArgs] = useState<Record<string, unknown>>(existing?.args ?? {});
  const [saving, setSaving] = useState(false);
  const skill = skills.find((s) => s.id === skillId) ?? null;
  const params = useMemo(() => (skill ? skillParams(skill) : []), [skill]);

  async function draft() {
    setDrafting(true);
    try {
      const d = await api.post<Draft>(`/api/workspaces/${workspaceId}/agent-work/workflows/draft`, { description });
      setName(d.name);
      setSkillId(d.skillId ?? "");
      setNote(d.note ?? "");
      setSchedule(d.schedule);
      setSavedArgs(d.args);
      setMissing(d.skillId ? null : (d.missingSkill ?? t("wf.noSkill")));
      setStep("form");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setDrafting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="wf-dialog">
        <DialogTitle>{existing ? t("wf.edit") : t("wf.new")}</DialogTitle>
        {step === "describe" ? (
          <div className="mt-3 space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium">{t("wf.describe")}</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={2000} placeholder={t("wf.describePh")} className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm" data-testid="wf-describe" />
            </label>
            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep("form")} data-testid="wf-manual">{t("wf.manual")}</Button>
              <Button onClick={() => void draft()} disabled={drafting || description.trim().length < 10} data-testid="wf-draft">
                {drafting ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {t("wf.aiSetup")}
              </Button>
            </div>
          </div>
        ) : (
          <WorkflowForm
            key={skillId || "none"}
            workspaceId={workspaceId}
            skills={skills}
            params={params}
            saved={saved}
            missing={missing}
            onOpenSkills={() => { onClose(); onOpenSkills(); }}
            state={{ name, setName, skillId, setSkillId: (id) => { setSkillId(id); setSavedArgs({}); setMissing(null); }, note, setNote, schedule, setSchedule }}
            scheduleText={scheduleText(schedule)}
            saving={saving}
            onCancel={onClose}
            onSave={async (args) => {
              setSaving(true);
              try {
                const body = { name: name.trim(), description: description.trim() || null, skillId, args, note: note.trim() || null, schedule };
                if (existing) await api.patch(`/api/agent-work/workflows/${existing.id}`, body);
                else await api.post(`/api/workspaces/${workspaceId}/agent-work/workflows`, body);
                toast.success(t("wf.saved"));
                onSaved();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t("common.failed"));
              } finally {
                setSaving(false);
              }
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface FormState {
  name: string;
  setName: (v: string) => void;
  skillId: string;
  setSkillId: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  schedule: WorkflowSchedule;
  setSchedule: (v: WorkflowSchedule) => void;
}

/** Keyed by the Skill: picking another Skill starts its parameters from their defaults. */
function WorkflowForm({ workspaceId, skills, params, saved, missing, onOpenSkills, state, scheduleText, saving, onCancel, onSave }: { workspaceId: string; skills: SkillLite[]; params: ReturnType<typeof skillParams>; saved: Record<string, unknown>; missing: string | null; onOpenSkills: () => void; state: FormState; scheduleText: string; saving: boolean; onCancel: () => void; onSave: (args: Record<string, unknown>) => void }) {
  const { t } = useT();
  const [initial] = useState(() => initialParamState(params, saved));
  const [values, setValues] = useState<ParamValues>(initial.values);
  const [ranges, setRanges] = useState<ParamRanges>(initial.ranges);
  const s = state.schedule;
  const set = (patch: Partial<WorkflowSchedule>) => state.setSchedule({ ...s, ...patch });
  function save() {
    const collected = collectArgs(params, values, ranges);
    if ("incomplete" in collected) return toast.error(t("cmd.rangeIncomplete", { label: collected.incomplete }));
    onSave(collected.args);
  }
  return (
    <div className="mt-3 space-y-3">
      {missing && (
        <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 p-2.5 text-xs text-amber-800 dark:text-amber-300" data-testid="wf-missing">
          {missing} <button className="underline font-medium" onClick={onOpenSkills}>{t("wf.createSkill")}</button>
        </div>
      )}
      <label className="block space-y-1">
        <span className="text-[11px] font-medium">{t("wf.name")}</span>
        <Input value={state.name} onChange={(e) => state.setName(e.target.value)} maxLength={160} className="h-8 text-sm" data-testid="wf-name" />
      </label>
      <label className="block space-y-1">
        <span className="text-[11px] font-medium">{t("wf.skill")}</span>
        <select value={state.skillId} onChange={(e) => state.setSkillId(e.target.value)} className={`${field} w-full`} data-testid="wf-skill">
          <option value="">{t("wf.pickSkill")}</option>
          {skills.map((sk) => (
            <option key={sk.id} value={sk.id}>{sk.command ? `/${sk.command} - ` : ""}{sk.name}</option>
          ))}
        </select>
      </label>
      <ParamFields workspaceId={workspaceId} params={params} values={values} setValues={setValues} ranges={ranges} setRanges={setRanges} />
      <label className="block space-y-1">
        <span className="text-[11px] font-medium">{t("cmd.note")}</span>
        <textarea value={state.note} onChange={(e) => state.setNote(e.target.value)} rows={2} maxLength={2000} placeholder={t("cmd.notePh")} className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm" />
      </label>
      <div className="space-y-1.5">
        <span className="text-[11px] font-medium">{t("wf.when")}</span>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <select value={s.freq} onChange={(e) => set({ freq: e.target.value as WorkflowSchedule["freq"] })} className={field} data-testid="wf-freq">
            {(["hourly", "daily", "weekly", "monthly"] as const).map((f) => <option key={f} value={f}>{t(`wf.freq.${f}` as MessageKey)}</option>)}
          </select>
          {s.freq === "monthly" && (
            <select value={s.monthDay} onChange={(e) => set({ monthDay: Number(e.target.value) })} className={field} aria-label={t("wf.monthDay")}>
              {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d === 31 ? t("wf.lastDay") : t("wf.dayN", { day: d })}</option>)}
            </select>
          )}
          {s.freq !== "hourly" && (
            <select value={s.hour} onChange={(e) => set({ hour: Number(e.target.value) })} className={field} aria-label={t("wf.hour")} data-testid="wf-hour">
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{pad(h)}h</option>)}
            </select>
          )}
          <select value={s.minute} onChange={(e) => set({ minute: Number(e.target.value) })} className={field} aria-label={t("wf.minute")}>
            {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => <option key={m} value={m}>:{pad(m)}</option>)}
          </select>
          <span className="text-neutral-400">{t("wf.vnTime")}</span>
        </div>
        {s.freq === "weekly" && (
          <div className="flex flex-wrap gap-1" data-testid="wf-days">
            {DAYS.map((d) => {
              const on = s.weekdays.includes(d);
              return (
                <button key={d} type="button" onClick={() => set({ weekdays: on ? s.weekdays.filter((x) => x !== d) : [...s.weekdays, d].sort() })} className={`h-7 px-2.5 rounded-full text-[11px] border ${on ? "bg-indigo-600 text-white border-indigo-600" : "border-neutral-300 dark:border-neutral-700"}`}>
                  {t(`wf.day.${d}` as MessageKey)}
                </button>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-indigo-600" data-testid="wf-summary">{scheduleText}</p>
      </div>
      <p className="text-[11px] text-neutral-400">{t("wf.selfOnly")}</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>{t("common.cancel")}</Button>
        <Button onClick={save} disabled={saving || !state.skillId || state.name.trim().length < 2 || (s.freq === "weekly" && !s.weekdays.length)} data-testid="wf-save">
          {saving && <Loader2 size={14} className="animate-spin" />} {t("wf.save")}
        </Button>
      </div>
    </div>
  );
}
