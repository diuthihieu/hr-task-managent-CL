"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Bot, CheckCircle2, Clock3, Download, FileOutput, History, Library, ListChecks, Loader2, Pencil, Play, Plus, Search, Settings, ShieldCheck, Sparkles, WandSparkles, XCircle } from "lucide-react";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { MetaChip, MetaStatus } from "@/components/ui/meta";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { cn, formatDate } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";
import type { AgentRunDto, AgentRunStatusValue, AgentSettingsDto, AgentSkillDto, AgentSuggestionDto, AgentWorkSnapshot } from "@/lib/agent-work/types";

type Tab = "overview" | "suggestions" | "active" | "skills" | "outputs" | "history" | "settings";

const TABS: Array<{ id: Tab; key: MessageKey; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "overview", key: "agent.tab.overview", icon: Activity },
  { id: "suggestions", key: "agent.tab.suggestions", icon: Sparkles },
  { id: "active", key: "agent.tab.active", icon: Play },
  { id: "skills", key: "agent.tab.skills", icon: WandSparkles },
  { id: "outputs", key: "agent.tab.outputs", icon: Library },
  { id: "history", key: "agent.tab.history", icon: History },
  { id: "settings", key: "agent.tab.settings", icon: Settings },
];

const STATUS_KEY: Record<AgentRunStatusValue, MessageKey> = {
  suggested: "agent.status.suggested",
  confirming: "agent.status.confirming",
  planning: "agent.status.planning",
  running: "agent.status.running",
  waiting_approval: "agent.status.waiting_approval",
  completed: "agent.status.completed",
  failed: "agent.status.failed",
  cancelled: "agent.status.cancelled",
};

const card = "rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900";
const ARTIFACT_FORMATS = ["markdown", "text", "json", "docx", "xlsx", "pptx", "pdf"] as const;
type ArtifactFormat = (typeof ARTIFACT_FORMATS)[number];
type SkillDraft = {
  name: string; description: string; instructions: string; triggers: string; inputSchema: string; workflow: string;
  toolsAllowed: string[]; referenceFiles: string; templates: string; validationRules: string; outputFormats: ArtifactFormat[];
  visibility: "private" | "specific_people" | "organization"; shareWithUserIds: string[];
};
const EMPTY_SKILL: SkillDraft = {
  name: "", description: "", instructions: "", triggers: "", inputSchema: '{"type":"object","properties":{"taskId":{"type":"string","format":"uuid"},"goal":{"type":"string"}},"required":["taskId","goal"]}',
  workflow: "Read permitted context\nApply instructions\nValidate output\nSave output\nReturn result to source Task",
  toolsAllowed: ["woli.read_task", "file.read", "artifact.save_text", "woli.create_task_comment"], referenceFiles: "", templates: "",
  validationRules: "Never exceed the current user's permissions\nDo not invent facts\nRequire approval for sensitive actions", outputFormats: ["markdown"], visibility: "private", shareWithUserIds: [],
};

const stringArray = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const lines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);

export function AgentWorkHub({ workspaceId, workspaceName, initialRunId }: { workspaceId: string; workspaceName: string; initialRunId: string | null }) {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>(initialRunId ? "active" : "overview");
  const [data, setData] = useState<AgentWorkSnapshot | null>(null);
  const [selectedRun, setSelectedRun] = useState<AgentRunDto | null>(null);
  const [settings, setSettings] = useState<AgentSettingsDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outputSearch, setOutputSearch] = useState("");
  const [outputSkill, setOutputSkill] = useState("");
  const [outputProject, setOutputProject] = useState("");
  const [outputType, setOutputType] = useState("");
  const [showCreateSkill, setShowCreateSkill] = useState(false);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState<SkillDraft>(EMPTY_SKILL);

  const load = useCallback(async () => {
    const snapshot = await api.get<AgentWorkSnapshot>(`/api/workspaces/${workspaceId}/agent-work`);
    setData(snapshot);
    setSettings(snapshot.settings);
    if (initialRunId) {
      const found = [...snapshot.activeRuns, ...snapshot.recentRuns].find((run) => run.id === initialRunId);
      setSelectedRun(found ?? (await api.get<AgentRunDto>(`/api/agent-work/runs/${initialRunId}`)));
    } else {
      setSelectedRun((current) => current ? [...snapshot.activeRuns, ...snapshot.recentRuns].find((run) => run.id === current.id) ?? current : null);
    }
    return snapshot;
  }, [initialRunId, workspaceId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate this client workspace from the authenticated API
    load().catch((error) => toast.error(error instanceof Error ? error.message : t("common.failed")));
  }, [load, t]);

  async function scan() {
    setBusy("scan");
    try {
      const suggestions = await api.post<AgentSuggestionDto[]>(`/api/workspaces/${workspaceId}/agent-work/suggestions`, { manual: true });
      await load();
      setTab("suggestions");
      if (!suggestions.length) toast.info(t("agent.empty.suggestions"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function decide(suggestion: AgentSuggestionDto, decision: "accept" | "dismiss", customGoal?: string) {
    setBusy(suggestion.id);
    try {
      const run = await api.patch<AgentRunDto>(`/api/agent-work/suggestions/${suggestion.id}`, { decision, customGoal });
      if (decision === "accept") {
        setSelectedRun(run);
        setTab("active");
      }
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function runAction(run: AgentRunDto, action: "execute" | "approve" | "reject" | "cancel") {
    setBusy(run.id);
    try {
      const result = await api.patch<AgentRunDto | { run: AgentRunDto; outputIds: string[] }>(`/api/agent-work/runs/${run.id}`, action === "execute" ? { action, confirmed: true } : { action });
      const next = "run" in result ? result.run : result;
      setSelectedRun(next);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function toggleSkill(skillId: string, active: boolean) {
    setBusy(skillId);
    try {
      await api.patch(`/api/agent-work/skills/${skillId}`, { active });
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  function startCreateSkill() {
    setEditingSkillId(null);
    setSkillDraft({ ...EMPTY_SKILL, toolsAllowed: [...EMPTY_SKILL.toolsAllowed], outputFormats: [...EMPTY_SKILL.outputFormats], shareWithUserIds: [] });
    setShowCreateSkill(true);
  }

  function startEditSkill(skill: AgentSkillDto) {
    setEditingSkillId(skill.id);
    setSkillDraft({
      name: skill.name,
      description: skill.description ?? "",
      instructions: skill.instructions,
      triggers: stringArray(skill.triggers).join(", "),
      inputSchema: JSON.stringify(skill.inputSchema ?? {}, null, 2),
      workflow: stringArray(skill.workflow).join("\n"),
      toolsAllowed: [...skill.toolsAllowed],
      referenceFiles: stringArray(skill.referenceFiles).join("\n"),
      templates: stringArray(skill.templates).join("\n"),
      validationRules: stringArray(skill.validationRules).join("\n"),
      outputFormats: skill.outputDefinitions.map((definition) => definition.format),
      visibility: skill.visibility as SkillDraft["visibility"],
      shareWithUserIds: [...skill.shareWithUserIds],
    });
    setShowCreateSkill(true);
  }

  async function saveSkill() {
    setBusy("create-skill");
    try {
      const inputSchema = JSON.parse(skillDraft.inputSchema || "{}");
      const toolsAllowed = Array.from(new Set([
        ...skillDraft.toolsAllowed,
        "woli.read_task",
        "woli.create_task_comment",
        ...(skillDraft.outputFormats.some((format) => ["markdown", "text", "json"].includes(format)) ? ["artifact.save_text"] : []),
        ...(skillDraft.outputFormats.some((format) => ["docx", "xlsx", "pptx", "pdf"].includes(format)) ? ["artifact.generate"] : []),
      ]));
      const payload = {
        name: skillDraft.name, description: skillDraft.description || null, instructions: skillDraft.instructions,
        triggers: skillDraft.triggers.split(",").map((value) => value.trim()).filter(Boolean), inputSchema, workflow: lines(skillDraft.workflow), toolsAllowed,
        referenceFiles: lines(skillDraft.referenceFiles), templates: lines(skillDraft.templates), validationRules: lines(skillDraft.validationRules),
        outputDefinitions: skillDraft.outputFormats.map((format) => ({ format, name: `${skillDraft.name} ${format.toUpperCase()}` })), visibility: skillDraft.visibility,
        shareWithUserIds: skillDraft.visibility === "specific_people" ? skillDraft.shareWithUserIds : [],
      };
      if (editingSkillId) await api.put(`/api/agent-work/skills/${editingSkillId}`, payload);
      else await api.post(`/api/workspaces/${workspaceId}/agent-work/skills`, payload);
      setSkillDraft({ ...EMPTY_SKILL, toolsAllowed: [...EMPTY_SKILL.toolsAllowed], outputFormats: [...EMPTY_SKILL.outputFormats], shareWithUserIds: [] });
      setEditingSkillId(null);
      setShowCreateSkill(false);
      setTab("skills");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function createSkillFromConversation(sourceConversationId: string) {
    setBusy("create-skill");
    try {
      await api.post(`/api/workspaces/${workspaceId}/agent-work/skills`, { sourceConversationId });
      setTab("skills");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings() {
    if (!settings) return;
    setBusy("settings");
    try {
      const next = await api.patch<AgentSettingsDto>(`/api/workspaces/${workspaceId}/agent-work/settings`, settings);
      setSettings(next);
      toast.success(t("agent.settings.saved"));
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  const filteredOutputs = useMemo(() => {
    const q = outputSearch.trim().toLowerCase();
    return (data?.outputs ?? []).filter((output) =>
      (!q || output.filename.toLowerCase().includes(q) || output.skill.name.toLowerCase().includes(q) || output.task?.title.toLowerCase().includes(q)) &&
      (!outputSkill || output.skill.id === outputSkill) &&
      (!outputProject || output.project?.id === outputProject) &&
      (!outputType || output.type === outputType)
    );
  }, [data?.outputs, outputProject, outputSearch, outputSkill, outputType]);

  if (!data || !settings) return <div className="flex h-full items-center justify-center text-neutral-500"><Loader2 size={18} className="animate-spin mr-2" />{t("common.loading")}</div>;

  const completedCount = data.recentRuns.filter((run) => run.status === "completed").length;
  const summaryCards: Array<{ key: MessageKey; value: number; icon: React.ComponentType<{ size?: number; className?: string }> }> = [
    { key: "agent.summary.suggestions", value: data.suggestions.length, icon: Sparkles },
    { key: "agent.summary.active", value: data.activeRuns.length, icon: Play },
    { key: "agent.summary.completed", value: completedCount, icon: CheckCircle2 },
    { key: "agent.summary.outputs", value: data.outputs.length, icon: FileOutput },
  ];
  return (
    <div className="flex-1 min-w-0 overflow-y-auto bg-neutral-50 dark:bg-neutral-950" data-testid="agent-work">
      <header className="sticky top-0 z-20 border-b border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-900/95 backdrop-blur px-5 pt-4">
        <div className="flex items-start gap-3 pb-4">
          <div className="h-9 w-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center"><Bot size={19} /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><h1 className="text-lg font-semibold text-neutral-950 dark:text-white">{t("agent.title")}</h1><MetaChip>{workspaceName}</MetaChip></div>
            <p className="text-xs text-neutral-500 mt-0.5 max-w-3xl">{t("agent.subtitle")}</p>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto thin-scroll" role="tablist">
          {TABS.map(({ id, key, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("inline-flex shrink-0 items-center gap-1.5 px-3 h-9 text-xs font-medium border-b-2", tab === id ? "border-indigo-600 text-indigo-700 dark:text-indigo-300" : "border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100")}><Icon size={14} />{t(key)}</button>)}
        </div>
      </header>

      <main className="p-5 max-w-6xl mx-auto space-y-4">
        {tab === "overview" && <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {summaryCards.map(({ key, value, icon: Icon }) => <div key={key} className={cn(card, "p-4")}><Icon size={16} className="text-indigo-600 mb-3" /><div className="text-2xl font-semibold">{value}</div><div className="text-xs text-neutral-500">{t(key)}</div></div>)}
          </section>
          <section className={cn(card, "p-5 bg-gradient-to-br from-indigo-50 to-white dark:from-indigo-950/40 dark:to-neutral-900")}>
            <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
              <div className="h-11 w-11 shrink-0 rounded-full bg-indigo-600 text-white flex items-center justify-center"><Sparkles size={20} /></div>
              <div className="flex-1"><h2 className="font-semibold">{t("agent.help.title")}</h2><p className="text-sm text-neutral-500 mt-1">{t("agent.help.body")}</p></div>
              <Button onClick={scan} disabled={busy === "scan" || !data.skills.some((skill) => skill.active)}>{busy === "scan" ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}{busy === "scan" ? t("agent.help.scanning") : t("agent.help.scan")}</Button>
            </div>
            {!data.skills.some((skill) => skill.active) && <p className="text-xs text-amber-700 dark:text-amber-300 mt-3">{t("agent.help.activate")}</p>}
          </section>
          <section className={cn(card, "p-4")}><div className="flex items-center gap-2 text-xs text-neutral-500"><ShieldCheck size={15} className="text-emerald-600" />{t("agent.skill.safety")}</div></section>
          {data.suggestions.length > 0 && <section><h2 className="text-sm font-semibold mb-2">{t("agent.tab.suggestions")}</h2><SuggestionList suggestions={data.suggestions.slice(0, 3)} busy={busy} onDecide={decide} /></section>}
        </>}

        {tab === "suggestions" && <section className="space-y-3">
          <div className="flex justify-between items-center"><div><h2 className="font-semibold">{t("agent.tab.suggestions")}</h2><p className="text-xs text-neutral-500">{t("agent.help.body")}</p></div><Button size="sm" onClick={scan} disabled={busy === "scan"}>{busy === "scan" ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}{t("agent.help.scan")}</Button></div>
          {data.suggestions.length ? <SuggestionList suggestions={data.suggestions} busy={busy} onDecide={decide} /> : <Empty text={t("agent.empty.suggestions")} />}
        </section>}

        {tab === "active" && <section className="grid lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.8fr)] gap-4">
          <div className="space-y-2">{data.activeRuns.length ? data.activeRuns.map((run) => <RunRow key={run.id} run={run} selected={selectedRun?.id === run.id} onClick={() => setSelectedRun(run)} t={t} />) : <Empty text={t("agent.empty.runs")} />}</div>
          <RunDetail run={selectedRun} busy={busy} onAction={runAction} t={t} />
        </section>}

        {tab === "skills" && <section className="space-y-3">
          <div className="flex justify-between items-center"><div><h2 className="font-semibold">{t("agent.tab.skills")}</h2><p className="text-xs text-neutral-500 mt-0.5">{t("agent.skill.safety")}</p></div><Button size="sm" onClick={startCreateSkill}><Plus size={13} />{t("agent.skill.new")}</Button></div>
          {showCreateSkill && <div className={cn(card, "p-5 space-y-4")}>
            <div className="flex items-center justify-between"><h3 className="font-semibold">{t(editingSkillId ? "agent.skill.edit" : "agent.skill.builder")}</h3>{editingSkillId && <MetaChip>{t("agent.skill.newVersion")}</MetaChip>}</div>
            <div className="grid md:grid-cols-2 gap-3"><label className="text-xs font-medium space-y-1"><span>{t("agent.skill.name")}</span><Input value={skillDraft.name} onChange={(event) => setSkillDraft((draft) => ({ ...draft, name: event.target.value }))} /></label><label className="text-xs font-medium space-y-1"><span>{t("agent.skill.description")}</span><Input value={skillDraft.description} onChange={(event) => setSkillDraft((draft) => ({ ...draft, description: event.target.value }))} /></label></div>
            <label className="block text-xs font-medium space-y-1"><span>{t("agent.skill.instructions")}</span><Textarea rows={5} value={skillDraft.instructions} onChange={(event) => setSkillDraft((draft) => ({ ...draft, instructions: event.target.value }))} /></label>
            <label className="block text-xs font-medium space-y-1"><span>{t("agent.skill.triggers")}</span><Input value={skillDraft.triggers} onChange={(event) => setSkillDraft((draft) => ({ ...draft, triggers: event.target.value }))} /></label>
            <div className="grid md:grid-cols-2 gap-3"><label className="text-xs font-medium space-y-1"><span>{t("agent.skill.workflow")}</span><Textarea rows={6} value={skillDraft.workflow} onChange={(event) => setSkillDraft((draft) => ({ ...draft, workflow: event.target.value }))} /></label><label className="text-xs font-medium space-y-1"><span>{t("agent.skill.validation")}</span><Textarea rows={6} value={skillDraft.validationRules} onChange={(event) => setSkillDraft((draft) => ({ ...draft, validationRules: event.target.value }))} /></label></div>
            <label className="block text-xs font-medium space-y-1"><span>{t("agent.skill.inputSchema")}</span><Textarea rows={5} className="font-mono text-[11px]" value={skillDraft.inputSchema} onChange={(event) => setSkillDraft((draft) => ({ ...draft, inputSchema: event.target.value }))} /></label>
            <div className="grid md:grid-cols-2 gap-3"><label className="text-xs font-medium space-y-1"><span>{t("agent.skill.references")}</span><Textarea rows={4} value={skillDraft.referenceFiles} onChange={(event) => setSkillDraft((draft) => ({ ...draft, referenceFiles: event.target.value }))} placeholder={t("agent.skill.onePerLine")} /></label><label className="text-xs font-medium space-y-1"><span>{t("agent.skill.templates")}</span><Textarea rows={4} value={skillDraft.templates} onChange={(event) => setSkillDraft((draft) => ({ ...draft, templates: event.target.value }))} placeholder={t("agent.skill.onePerLine")} /></label></div>
            <fieldset><legend className="text-xs font-medium mb-2">{t("agent.skill.tools")}</legend><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">{data.tools.map((tool) => <label key={tool.name} className="flex items-start gap-2 rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 text-xs"><input type="checkbox" className="mt-0.5 accent-indigo-600" checked={skillDraft.toolsAllowed.includes(tool.name)} onChange={(event) => setSkillDraft((draft) => ({ ...draft, toolsAllowed: event.target.checked ? [...draft.toolsAllowed, tool.name] : draft.toolsAllowed.filter((name) => name !== tool.name) }))} /><span><span className="font-medium block">{tool.label}</span><span className="text-neutral-500">{tool.name}</span></span></label>)}</div></fieldset>
            <fieldset><legend className="text-xs font-medium mb-2">{t("agent.skill.outputs")}</legend><div className="flex flex-wrap gap-2">{ARTIFACT_FORMATS.map((format) => <label key={format} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 px-2.5 py-1.5 text-xs uppercase"><input type="checkbox" className="accent-indigo-600" checked={skillDraft.outputFormats.includes(format)} onChange={(event) => setSkillDraft((draft) => ({ ...draft, outputFormats: event.target.checked ? [...draft.outputFormats, format] : draft.outputFormats.filter((value) => value !== format) }))} />{format}</label>)}</div></fieldset>
            <div className="grid md:grid-cols-2 gap-3"><label className="text-xs font-medium space-y-1"><span>{t("agent.skill.visibility")}</span><select value={skillDraft.visibility} onChange={(event) => setSkillDraft((draft) => ({ ...draft, visibility: event.target.value as SkillDraft["visibility"] }))} className="h-9 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm"><option value="private">{t("agent.skill.private")}</option><option value="specific_people">{t("agent.skill.specific")}</option><option value="organization">{t("agent.skill.organization")}</option></select></label>{skillDraft.visibility === "specific_people" && <fieldset><legend className="text-xs font-medium mb-1">{t("agent.skill.people")}</legend><div className="max-h-28 overflow-y-auto rounded-md border border-neutral-200 dark:border-neutral-800 p-2 space-y-1">{data.members.map((member) => <label key={member.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={skillDraft.shareWithUserIds.includes(member.id)} onChange={(event) => setSkillDraft((draft) => ({ ...draft, shareWithUserIds: event.target.checked ? [...draft.shareWithUserIds, member.id] : draft.shareWithUserIds.filter((id) => id !== member.id) }))} />{member.name}</label>)}</div></fieldset>}</div>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => { setShowCreateSkill(false); setEditingSkillId(null); }}>{t("common.cancel")}</Button><Button onClick={saveSkill} disabled={!skillDraft.name.trim() || skillDraft.instructions.trim().length < 10 || !lines(skillDraft.workflow).length || !lines(skillDraft.validationRules).length || !skillDraft.outputFormats.length || busy === "create-skill"}>{busy === "create-skill" && <Loader2 size={13} className="animate-spin" />}{t(editingSkillId ? "common.save" : "common.create")}</Button></div>
          </div>}
          <div className="grid md:grid-cols-2 gap-3">{data.skills.map((skill) => <div key={skill.id} className={cn(card, "p-4")}><div className="flex items-start gap-3"><div className="h-9 w-9 rounded-lg bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 flex items-center justify-center"><WandSparkles size={17} /></div><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><h3 className="font-medium truncate">{skill.name}</h3><MetaChip>v{skill.version}</MetaChip></div><p className="text-xs text-neutral-500 mt-1 line-clamp-2">{skill.description}</p><div className="flex flex-wrap gap-1 mt-2">{skill.outputDefinitions.map((output) => <MetaChip key={`${output.format}-${output.name}`}>{output.format.toUpperCase()}</MetaChip>)}</div><div className="flex flex-wrap gap-1 mt-2">{skill.toolsAllowed.map((tool) => <MetaChip key={tool}>{tool}</MetaChip>)}</div></div></div><div className="mt-4 flex items-center justify-between"><MetaStatus className={skill.active ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : undefined}>{t(skill.active ? "agent.skill.active" : "agent.skill.inactive")}</MetaStatus><div className="flex gap-2">{skill.ownedByMe && !skill.systemKey && <Button size="sm" variant="ghost" onClick={() => startEditSkill(skill)}><Pencil size={12} />{t("agent.skill.edit")}</Button>}<Button size="sm" variant={skill.active ? "outline" : "default"} onClick={() => toggleSkill(skill.id, !skill.active)} disabled={busy === skill.id}>{busy === skill.id && <Loader2 size={12} className="animate-spin" />}{t(skill.active ? "agent.skill.deactivate" : skill.ownedByMe ? "agent.skill.activate" : "agent.skill.install")}</Button></div></div></div>)}</div>
        </section>}

        {tab === "outputs" && <section className="space-y-3"><div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"><h2 className="font-semibold">{t("agent.tab.outputs")}</h2><div className="relative sm:w-72"><Search size={14} className="absolute left-2.5 top-2.5 text-neutral-400" /><Input className="pl-8" value={outputSearch} onChange={(event) => setOutputSearch(event.target.value)} placeholder={t("agent.output.search")} /></div></div><div className="grid sm:grid-cols-3 gap-2"><select value={outputSkill} onChange={(event) => setOutputSkill(event.target.value)} className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-xs"><option value="">{t("agent.tab.skills")}: {t("graph.showAll")}</option>{data.skills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select><select value={outputProject} onChange={(event) => setOutputProject(event.target.value)} className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-xs"><option value="">{t("agent.output.source")}: {t("graph.showAll")}</option>{Array.from(new Map(data.outputs.flatMap((output) => output.project ? [[output.project.id, output.project.name] as const] : [])).entries()).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select><select value={outputType} onChange={(event) => setOutputType(event.target.value)} className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-xs"><option value="">Type: {t("graph.showAll")}</option>{Array.from(new Set(data.outputs.map((output) => output.type))).map((type) => <option key={type} value={type}>{type}</option>)}</select></div>{filteredOutputs.length ? <div className={cn(card, "divide-y divide-neutral-200 dark:divide-neutral-800")}>{filteredOutputs.map((output) => <div key={output.id} className="p-3 flex items-center gap-3"><div className="h-9 w-9 rounded-lg bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center"><FileOutput size={16} /></div><div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{output.filename}</div><div className="text-[11px] text-neutral-500 flex flex-wrap gap-2"><span>{output.skill.name}</span><span>{output.task?.title ?? output.project?.name ?? workspaceName}</span><span>{formatDate(output.createdAt, true)}</span></div></div><a href={`/api/agent-work/outputs/${output.id}/download`}><Button size="icon" variant="ghost" aria-label={t("common.download")}><Download size={15} /></Button></a></div>)}</div> : <Empty text={t("agent.empty.outputs")} />}</section>}

        {tab === "history" && <section className="space-y-3"><h2 className="font-semibold">{t("agent.tab.history")}</h2>{data.history.length ? <div className={cn(card, "divide-y divide-neutral-200 dark:divide-neutral-800")}>{data.history.map((conversation) => <div key={conversation.id} className="p-3 flex items-center gap-3"><div className="h-8 w-8 rounded-lg bg-indigo-50 dark:bg-indigo-950 flex items-center justify-center text-indigo-600"><Bot size={15} /></div><div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{conversation.title}</div><div className="text-[11px] text-neutral-500 flex gap-2"><span>{conversation.kind}</span><span>{conversation.task?.title ?? conversation.originType ?? workspaceName}</span><span>{formatDate(conversation.updatedAt, true)}</span></div></div>{conversation.agentRun ? <Button size="sm" variant="ghost" onClick={() => { const run = [...data.activeRuns, ...data.recentRuns].find((item) => item.id === conversation.agentRun?.id); if (run) setSelectedRun(run); setTab("active"); }}>{t("agent.popup.review")}</Button> : <Button size="sm" variant="outline" onClick={() => createSkillFromConversation(conversation.id)} disabled={busy === "create-skill"}>{t("agent.skill.fromConversation")}</Button>}</div>)}</div> : <Empty text={t("agent.empty.history")} />}</section>}

        {tab === "settings" && <section className={cn(card, "p-5 max-w-2xl space-y-5")}><h2 className="font-semibold">{t("agent.tab.settings")}</h2><SettingToggle label={t("agent.settings.proactive")} checked={settings.proactiveEnabled} onChange={(checked) => setSettings({ ...settings, proactiveEnabled: checked })} /><label className="block"><span className="block text-sm font-medium mb-1">{t("agent.settings.mode")}</span><select value={settings.suggestionMode} onChange={(event) => setSettings({ ...settings, suggestionMode: event.target.value as AgentSettingsDto["suggestionMode"] })} className="h-9 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm"><option value="silent">{t("agent.settings.silent")}</option><option value="smart">{t("agent.settings.smart")}</option><option value="proactive">{t("agent.settings.proactiveMode")}</option></select></label><label className="block"><span className="flex justify-between text-sm font-medium mb-1"><span>{t("agent.settings.confidence")}</span><span>{Math.round(settings.minimumConfidence * 100)}%</span></span><input type="range" min="75" max="99" value={Math.round(settings.minimumConfidence * 100)} onChange={(event) => setSettings({ ...settings, minimumConfidence: Number(event.target.value) / 100 })} className="w-full" /></label><div className="space-y-3"><SettingToggle label={t("agent.settings.assigned")} checked={settings.scanScope.assignedToMe !== false} onChange={(checked) => setSettings({ ...settings, scanScope: { ...settings.scanScope, assignedToMe: checked } })} /><SettingToggle label={t("agent.settings.created")} checked={settings.scanScope.createdByMe !== false} onChange={(checked) => setSettings({ ...settings, scanScope: { ...settings.scanScope, createdByMe: checked } })} /><SettingToggle label={t("agent.settings.allVisible")} checked={settings.scanScope.includeAllVisible === true} onChange={(checked) => setSettings({ ...settings, scanScope: { ...settings.scanScope, includeAllVisible: checked } })} /></div><SettingToggle label={t("agent.settings.confirm")} checked={settings.requireConfirmation} onChange={(checked) => setSettings({ ...settings, requireConfirmation: checked })} /><div className="flex justify-between items-center opacity-60"><div><div className="text-sm font-medium">{t("agent.settings.auto")}</div><div className="text-xs text-neutral-500">{t("agent.settings.autoDisabled")}</div></div><input type="checkbox" checked={false} disabled /></div><div className="flex justify-end"><Button onClick={saveSettings} disabled={busy === "settings"}>{busy === "settings" && <Loader2 size={13} className="animate-spin" />}{t("common.save")}</Button></div></section>}
      </main>
    </div>
  );
}

function SuggestionList({ suggestions, busy, onDecide }: { suggestions: AgentSuggestionDto[]; busy: string | null; onDecide: (suggestion: AgentSuggestionDto, decision: "accept" | "dismiss", customGoal?: string) => void }) {
  const { t } = useT();
  const [customFor, setCustomFor] = useState<string | null>(null);
  const [customGoal, setCustomGoal] = useState("");
  return <div className="space-y-3">{suggestions.map((suggestion) => <article key={suggestion.id} className={cn(card, "p-4")}><div className="flex items-start gap-3"><div className="h-9 w-9 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 flex items-center justify-center"><Sparkles size={16} /></div><div className="flex-1 min-w-0"><div className="flex flex-wrap gap-2 items-center"><h3 className="font-medium">{suggestion.title}</h3><MetaStatus className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">{t("agent.confidence", { value: Math.round(suggestion.confidence * 100) })}</MetaStatus></div><p className="text-sm text-neutral-600 dark:text-neutral-300 mt-1">{suggestion.reason}</p><div className="text-xs text-neutral-500 mt-2"><span className="font-medium">{t("agent.impact")}:</span> {suggestion.impact}</div><div className="flex gap-1.5 mt-2"><MetaChip>{suggestion.task.project.name}</MetaChip><MetaChip>{suggestion.skill.name}</MetaChip></div></div></div>{customFor === suggestion.id && <div className="mt-3"><Textarea rows={3} value={customGoal} onChange={(event) => setCustomGoal(event.target.value)} placeholder={t("agent.action.customPh")} /></div>}<div className="mt-4 flex flex-wrap justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => onDecide(suggestion, "dismiss")} disabled={busy === suggestion.id}>{t("agent.action.notNow")}</Button><Button size="sm" variant="outline" onClick={() => setCustomFor(customFor === suggestion.id ? null : suggestion.id)}>{t("agent.action.custom")}</Button><Button size="sm" variant="outline" onClick={() => onDecide(suggestion, "accept", customFor === suggestion.id && customGoal.trim() ? customGoal : undefined)} disabled={busy === suggestion.id}>{t("agent.action.showPlan")}</Button><Button size="sm" onClick={() => onDecide(suggestion, "accept", customFor === suggestion.id && customGoal.trim() ? customGoal : undefined)} disabled={busy === suggestion.id}>{busy === suggestion.id ? <Loader2 size={12} className="animate-spin" /> : <ListChecks size={12} />}{t("agent.action.handle")}</Button></div></article>)}</div>;
}

function RunRow({ run, selected, onClick, t }: { run: AgentRunDto; selected: boolean; onClick: () => void; t: ReturnType<typeof useT>["t"] }) {
  return <button onClick={onClick} className={cn(card, "w-full p-3 text-left hover:border-indigo-300", selected && "border-indigo-500 ring-1 ring-indigo-500/20")}><div className="flex justify-between gap-2"><div className="font-medium text-sm truncate">{run.task?.title ?? run.goal}</div><MetaStatus>{t(STATUS_KEY[run.status])}</MetaStatus></div><div className="text-xs text-neutral-500 mt-1 truncate">{run.skill.name} · {formatDate(run.updatedAt, true)}</div></button>;
}

function RunDetail({ run, busy, onAction, t }: { run: AgentRunDto | null; busy: string | null; onAction: (run: AgentRunDto, action: "execute" | "approve" | "reject" | "cancel") => void; t: ReturnType<typeof useT>["t"] }) {
  if (!run) return <div className={cn(card, "p-5 text-sm text-neutral-500")}>{t("agent.empty.runs")}</div>;
  const plan = Array.isArray(run.plan) ? run.plan.filter((step): step is string => typeof step === "string") : [];
  const pending = busy === run.id;
  return <aside className={cn(card, "p-5 h-fit lg:sticky lg:top-32")}><div className="flex items-center justify-between"><MetaStatus>{t(STATUS_KEY[run.status])}</MetaStatus><span className="text-[11px] text-neutral-400">{formatDate(run.createdAt, true)}</span></div><h3 className="text-sm font-semibold mt-4">{t("agent.goal")}</h3><p className="text-sm text-neutral-700 dark:text-neutral-300 mt-1 whitespace-pre-wrap">{run.goal}</p><h3 className="text-sm font-semibold mt-4">{t("agent.plan")}</h3><ol className="mt-2 space-y-2">{plan.map((step, index) => <li key={`${index}-${step}`} className="flex gap-2 text-sm"><span className="h-5 w-5 shrink-0 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 text-[10px] flex items-center justify-center">{index + 1}</span><span>{step}</span></li>)}</ol>{run.status === "planning" && !plan.length && <div className="mt-2 text-xs text-neutral-500 flex items-center gap-2"><Loader2 size={12} className="animate-spin" />{t("agent.help.scanning")}</div>}{run.outputSummary && <div className="mt-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 p-3 text-sm text-emerald-800 dark:text-emerald-200">{run.outputSummary}</div>}{run.failureReason && <div className="mt-4 rounded-lg bg-red-50 dark:bg-red-950/40 p-3 text-sm text-red-700 dark:text-red-300">{run.failureReason}</div>}{run.outputs.length > 0 && <div className="mt-3 space-y-1">{run.outputs.map((output) => <a key={output.id} href={`/api/agent-work/outputs/${output.id}/download`} className="flex items-center gap-2 text-xs text-indigo-600 hover:underline"><Download size={12} />{output.filename}</a>)}</div>}<div className="mt-5 flex flex-wrap justify-end gap-2">{["confirming", "planning", "running", "waiting_approval"].includes(run.status) && <Button size="sm" variant="ghost" onClick={() => onAction(run, "cancel")} disabled={pending}><XCircle size={13} />{t("agent.action.cancelRun")}</Button>}{run.status === "planning" && <Button size="sm" onClick={() => onAction(run, "execute")} disabled={pending || !plan.length}>{pending ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}{t("agent.action.confirmRun")}</Button>}{run.status === "waiting_approval" && <><Button size="sm" variant="destructive" onClick={() => onAction(run, "reject")} disabled={pending}>{t("agent.action.reject")}</Button><Button size="sm" onClick={() => onAction(run, "approve")} disabled={pending}><ShieldCheck size={13} />{t("agent.action.approve")}</Button></>}</div></aside>;
}

function SettingToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex items-center justify-between gap-4"><span className="text-sm font-medium">{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 accent-indigo-600" /></label>;
}

function Empty({ text }: { text: string }) {
  return <div className={cn(card, "p-8 text-center text-sm text-neutral-500")}><Clock3 size={20} className="mx-auto mb-2 opacity-50" />{text}</div>;
}
