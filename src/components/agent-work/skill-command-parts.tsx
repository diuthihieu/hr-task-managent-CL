"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { ChevronDown, Download, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateInput } from "@/components/ui/date-input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchList, foldText } from "@/components/ui/search-list";
import { Markdown } from "@/components/ai/markdown";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";
import { initialParamState, type ParamValues, type ParamRanges } from "./param-state";
import { DATE_FIELDS, DATE_PRESETS, SKILL_PARAMETER_TYPES, type SkillParameter } from "@/lib/agent-work/skill-schema";

/** "Báo cáo tuần" -> "bao-cao-tuan". */
export function slugifyCommand(text: string): string {
  return foldText(text)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const field = "h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-xs";

/** Editor for the inputs a command asks: type, label, default. */
export function ParametersEditor({ value, onChange }: { value: SkillParameter[]; onChange: (v: SkillParameter[]) => void }) {
  const { t } = useT();
  const set = (i: number, patch: Partial<SkillParameter>) => onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const add = () => {
    const n = value.length + 1;
    onChange([...value, { key: `p${n}`, label: t("cmd.param.newLabel"), type: "date_range", required: false, default: "last_week", dateField: "completed" }]);
  };
  return (
    <div className="space-y-2" data-testid="skill-params">
      {value.map((p, i) => (
        <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
          <Input className="h-8 text-xs" value={p.label} onChange={(e) => set(i, { label: e.target.value, key: slugifyCommand(e.target.value).replace(/-/g, "_").replace(/^[^a-z]+/, "") || `p${i + 1}` })} placeholder={t("cmd.param.label")} data-testid={`skill-param-label-${i}`} />
          <select className={field} value={p.type} onChange={(e) => set(i, { type: e.target.value as SkillParameter["type"], default: e.target.value === "date_range" ? "last_week" : e.target.value === "people" ? "me" : "" })} data-testid={`skill-param-type-${i}`}>
            {SKILL_PARAMETER_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`cmd.type.${type}` as MessageKey)}
              </option>
            ))}
          </select>
          {p.type === "date_range" ? (
            <div className="flex gap-1">
              <select className={`${field} flex-1 min-w-0`} value={p.default ?? ""} onChange={(e) => set(i, { default: e.target.value || undefined })} aria-label={t("cmd.param.default")}>
                <option value="">{t("cmd.preset.none")}</option>
                {DATE_PRESETS.map((d) => (
                  <option key={d} value={d}>
                    {t(`cmd.preset.${d}` as MessageKey)}
                  </option>
                ))}
              </select>
              <select className={`${field} flex-1 min-w-0`} value={p.dateField ?? "completed"} onChange={(e) => set(i, { dateField: e.target.value as SkillParameter["dateField"] })} aria-label={t("cmd.param.dateField")}>
                {DATE_FIELDS.map((d) => (
                  <option key={d} value={d}>
                    {t(`cmd.field.${d}` as MessageKey)}
                  </option>
                ))}
              </select>
            </div>
          ) : p.type === "people" ? (
            <select className={field} value={p.default ?? ""} onChange={(e) => set(i, { default: e.target.value || undefined })} aria-label={t("cmd.param.default")}>
              <option value="">{t("cmd.people.all")}</option>
              <option value="me">{t("cmd.people.me")}</option>
            </select>
          ) : p.type === "text" ? (
            <Input className="h-8 text-xs" value={p.default ?? ""} onChange={(e) => set(i, { default: e.target.value || undefined })} placeholder={t("cmd.param.default")} />
          ) : (
            <span className="text-[11px] text-neutral-500">{t("cmd.projects.all")}</span>
          )}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px]">
              <input type="checkbox" checked={p.required} onChange={(e) => set(i, { required: e.target.checked })} />
              {t("cmd.param.required")}
            </label>
            <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="text-neutral-400 hover:text-red-600" aria-label={t("common.delete")}>
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}
      {value.length < 8 && (
        <Button type="button" size="sm" variant="outline" onClick={add} data-testid="skill-param-add">
          <Plus size={12} /> {t("cmd.param.add")}
        </Button>
      )}
    </div>
  );
}

export interface RunnableSkill {
  id: string;
  name: string;
  description: string | null;
  command: string | null;
  parameters: unknown;
}
interface RunResult {
  run: { id: string; status: string; outputs: { id: string; filename: string; type: string }[]; approvals?: { status: string; kind: string }[] };
  outputIds?: string[];
  content?: string;
}

function MultiSelect({ items, value, onChange, all, testId }: { items: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; all: string; testId: string }) {
  const { t } = useT();
  const shown = value.length === 0 ? all : value.length === 1 ? (items.find((i) => i.value === value[0])?.label ?? "1") : t("mx.selected", { count: value.length });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={`${field} w-full flex items-center justify-between`} data-testid={testId}>
          <span className="truncate">{shown}</span>
          <ChevronDown size={13} className="text-neutral-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(22rem,calc(100vw-24px))] p-1.5 pt-2">
        <SearchList items={items} selected={value} testId={testId} onPick={(v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])} />
      </PopoverContent>
    </Popover>
  );
}

export { initialParamState, type ParamValues, type ParamRanges } from "./param-state";

/** Arguments to send, or the label of a date range with only one end filled. */
export function collectArgs(params: SkillParameter[], values: ParamValues, ranges: ParamRanges): { args: Record<string, unknown> } | { incomplete: string } {
  // A custom range needs both ends: never fall back silently to the default or to no date filter.
  const half = params.find((p) => p.type === "date_range" && !!ranges[p.key] && !ranges[p.key].from !== !ranges[p.key].to);
  if (half) return { incomplete: half.label };
  const args: Record<string, unknown> = {};
  for (const p of params) {
    if (p.type === "date_range") {
      const r = ranges[p.key];
      args[p.key] = r?.from && r?.to ? { from: r.from, to: r.to } : values[p.key] || undefined;
    } else args[p.key] = values[p.key];
  }
  return { args };
}

/** The inputs for a Skill's parameters (presets or dates, projects, people, text). */
export function ParamFields({ workspaceId, params, values, setValues, ranges, setRanges }: { workspaceId: string; params: SkillParameter[]; values: ParamValues; setValues: React.Dispatch<React.SetStateAction<ParamValues>>; ranges: ParamRanges; setRanges: React.Dispatch<React.SetStateAction<ParamRanges>> }) {
  const { t } = useT();
  const [projects, setProjects] = useState<{ value: string; label: string }[]>([]);
  const [members, setMembers] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    if (params.some((p) => p.type === "projects")) api.get<{ id: string; name: string }[]>(`/api/workspaces/${workspaceId}/projects`).then((r) => setProjects(r.map((p) => ({ value: p.id, label: p.name })))).catch(() => {});
    if (params.some((p) => p.type === "people")) api.get<{ id: string; name: string; email: string }[]>(`/api/workspaces/${workspaceId}/members`).then((r) => setMembers([{ value: "me", label: t("cmd.people.me") }, ...r.map((m) => ({ value: m.id, label: `${m.name} - ${m.email}` }))])).catch(() => {});
  }, [params, workspaceId, t]);
  return (
    <>
      {params.map((p) => (
        <div key={p.key} className="space-y-1">
          <div className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">
            {p.label}
            {p.required ? " *" : ""}
            {p.type === "date_range" && <span className="font-normal text-neutral-400"> - {t(`cmd.field.${p.dateField ?? "completed"}` as MessageKey)}</span>}
          </div>
          {p.type === "date_range" ? (
            <div className="grid grid-cols-[1fr_auto_auto] gap-1.5 items-center">
              <select className={field} value={String(values[p.key] ?? "")} onChange={(e) => { setValues((v) => ({ ...v, [p.key]: e.target.value })); setRanges((r) => ({ ...r, [p.key]: { from: null, to: null } })); }} data-testid={`run-param-${p.key}`}>
                <option value="">{t("cmd.preset.custom")}</option>
                {DATE_PRESETS.map((d) => (
                  <option key={d} value={d}>
                    {t(`cmd.preset.${d}` as MessageKey)}
                  </option>
                ))}
              </select>
              <DateInput className={field} value={ranges[p.key]?.from ?? null} onCommit={(from) => { setRanges((r) => ({ ...r, [p.key]: { from, to: r[p.key]?.to ?? null } })); setValues((v) => ({ ...v, [p.key]: "" })); }} aria-label={t("mx.from")} />
              <DateInput className={field} value={ranges[p.key]?.to ?? null} onCommit={(to) => { setRanges((r) => ({ ...r, [p.key]: { from: r[p.key]?.from ?? null, to } })); setValues((v) => ({ ...v, [p.key]: "" })); }} aria-label={t("mx.to")} />
            </div>
          ) : p.type === "projects" ? (
            <MultiSelect items={projects} value={(values[p.key] as string[]) ?? []} onChange={(v) => setValues((x) => ({ ...x, [p.key]: v }))} all={t("cmd.projects.all")} testId={`run-param-${p.key}`} />
          ) : p.type === "people" ? (
            <MultiSelect items={members} value={(values[p.key] as string[]) ?? []} onChange={(v) => setValues((x) => ({ ...x, [p.key]: v }))} all={t("cmd.people.all")} testId={`run-param-${p.key}`} />
          ) : (
            <Input className="h-8 text-xs" value={String(values[p.key] ?? "")} onChange={(e) => setValues((v) => ({ ...v, [p.key]: e.target.value }))} data-testid={`run-param-${p.key}`} />
          )}
        </div>
      ))}
    </>
  );
}

export const skillParams = (skill: { parameters: unknown }): SkillParameter[] => (Array.isArray(skill.parameters) ? (skill.parameters as SkillParameter[]) : []);

/**
 * Run a Skill now: fill its parameters (defaults pre-filled), add a note, Run. Shows the result and its
 * files when done, or the approval request when the request touches sensitive data.
 */
export function SkillRunDialog({ workspaceId, skill, initialNote = "", onClose, onDone }: { workspaceId: string; skill: RunnableSkill; initialNote?: string; onClose: () => void; onDone?: () => void }) {
  const { t } = useT();
  const params = useMemo(() => skillParams(skill), [skill]);
  const [initial] = useState(() => initialParamState(params));
  const [values, setValues] = useState<ParamValues>(initial.values);
  const [ranges, setRanges] = useState<ParamRanges>(initial.ranges);
  const [note, setNote] = useState(initialNote);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  // Approvals live in Agent Work, wherever the dialog was opened from (Ask AI or the Skill card).
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();

  async function run() {
    const collected = collectArgs(params, values, ranges);
    if ("incomplete" in collected) return toast.error(t("cmd.rangeIncomplete", { label: collected.incomplete }));
    setBusy(true);
    try {
      const r = await api.post<RunResult>(`/api/workspaces/${workspaceId}/agent-work/commands`, { skillId: skill.id, args: collected.args, note: note.trim() || undefined });
      setResult(r);
      onDone?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  const waiting = result && result.run.status === "waiting_approval";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="skill-run-dialog">
        <DialogTitle className="text-base font-semibold">
          {skill.command ? <span className="font-mono text-indigo-600">/{skill.command}</span> : null} {skill.name}
        </DialogTitle>
        {skill.description && <p className="mt-1 text-xs text-neutral-500">{skill.description}</p>}
        {!result ? (
          <div className="mt-4 space-y-3">
            <ParamFields workspaceId={workspaceId} params={params} values={values} setValues={setValues} ranges={ranges} setRanges={setRanges} />
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-neutral-600 dark:text-neutral-300">{t("cmd.note")}</div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder={t("cmd.notePh")} className="w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1.5 text-sm" data-testid="run-note" />
            </div>
            <p className="text-[11px] text-neutral-400">{t("cmd.scopeHint")}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                {t("common.cancel")}
              </Button>
              <Button onClick={run} disabled={busy} data-testid="run-start">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} {busy ? t("cmd.running") : t("cmd.run")}
              </Button>
            </div>
          </div>
        ) : waiting ? (
          <div className="mt-4 space-y-3" data-testid="run-waiting">
            <p className="text-sm text-amber-700 dark:text-amber-300">{t("cmd.waiting")}</p>
            <div className="flex justify-end gap-2">
              <a href={`/w/${workspaceSlug}/agent-work?run=${result.run.id}`}>
                <Button variant="outline">{t("cmd.openRun")}</Button>
              </a>
              <Button onClick={onClose}>{t("common.close")}</Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3" data-testid="run-result">
            {result.run.outputs.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {result.run.outputs.map((o) => (
                  <a key={o.id} href={`/api/agent-work/outputs/${o.id}/download`} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-1 text-xs hover:border-indigo-400" data-testid="run-output">
                    <Download size={12} /> {o.filename}
                  </a>
                ))}
              </div>
            )}
            {result.content && (
              <div className="max-h-[50vh] overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800 p-3 text-sm">
                <Markdown text={result.content} />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setResult(null)}>
                {t("cmd.again")}
              </Button>
              <Button onClick={onClose}>{t("common.close")}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** "/command note" typed in a chat box: the command (lower-case) and the rest as a note, or null. */
export function parseSlash(text: string): { command: string; note: string } | null {
  const m = /^\/([a-z0-9-]*)(?:\s+([\s\S]*))?$/i.exec(text.trimStart());
  return m ? { command: m[1].toLowerCase(), note: (m[2] ?? "").trim() } : null;
}

/**
 * Slash commands for a chat composer: the Skills I can run (loaded once, when "/" is first typed),
 * the ones matching what is typed, and the run dialog for the chosen one.
 */
export function useSlashCommands(workspaceId: string | undefined, draft: string) {
  const [skills, setSkills] = useState<RunnableSkill[] | null>(null);
  const [running, setRunning] = useState<{ skill: RunnableSkill; note: string } | null>(null);
  const [active, setActive] = useState(0);
  const slash = workspaceId ? parseSlash(draft) : null;
  const typingCommand = !!slash && !/\s/.test(draft.trimStart());
  const wantsList = !!slash && !skills;
  useEffect(() => {
    if (!wantsList || !workspaceId) return;
    api.get<RunnableSkill[]>(`/api/workspaces/${workspaceId}/agent-work/commands`).then(setSkills).catch(() => setSkills([]));
  }, [wantsList, workspaceId]);
  const matches = typingCommand && skills ? skills.filter((s) => s.command?.startsWith(slash!.command)) : [];
  /** The Skill whose exact command was typed (with or without a note). */
  const exact = slash && skills ? (skills.find((s) => s.command === slash.command) ?? null) : null;
  return {
    open: typingCommand,
    skills,
    matches,
    active: Math.min(active, Math.max(matches.length - 1, 0)),
    setActive,
    exact,
    note: slash?.note ?? "",
    running,
    start: (skill: RunnableSkill, note: string) => setRunning({ skill, note }),
    close: () => setRunning(null),
  };
}

export function SlashMenu({ slash, onPick }: { slash: ReturnType<typeof useSlashCommands>; onPick: (s: RunnableSkill) => void }) {
  const { t } = useT();
  if (!slash.open) return null;
  return (
    <div role="listbox" className="absolute bottom-full left-0 right-0 mb-2 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg p-1 max-h-64 overflow-y-auto z-20" data-testid="slash-menu">
      <p className="px-2 py-1 text-[11px] font-medium text-neutral-500">{t("cmd.pick")}</p>
      {slash.skills === null ? (
        <p className="px-2 py-2 text-xs text-neutral-400">…</p>
      ) : slash.matches.length === 0 ? (
        <p className="px-2 py-2 text-xs text-neutral-500">{t("cmd.none")}</p>
      ) : (
        slash.matches.map((s, i) => (
          <button
            key={s.id}
            type="button"
            role="option"
            aria-selected={i === slash.active}
            onMouseDown={(e) => e.preventDefault()}
            onMouseEnter={() => slash.setActive(i)}
            onClick={() => onPick(s)}
            className={`w-full text-left rounded-lg px-2 py-1.5 flex items-baseline gap-2 ${i === slash.active ? "bg-indigo-50 dark:bg-indigo-950/50" : ""}`}
            data-testid={`slash-${s.command}`}
          >
            <span className="font-mono text-xs text-indigo-700 dark:text-indigo-300">/{s.command}</span>
            <span className="text-sm text-neutral-800 dark:text-neutral-100 truncate">{s.name}</span>
          </button>
        ))
      )}
    </div>
  );
}
