"use client";
// Record or edit a decision: what, why, alternatives considered, evidence,
// people involved, date, project, and which older decision it supersedes.
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import type { DecisionDto } from "@/lib/brain/decisions";
import type { MessageKey } from "@/lib/i18n/core";

export type Decision = DecisionDto;

export interface DecisionPrefill {
  title?: string;
  evidence?: string;
  wikiPageId?: string;
  sourceBlockId?: string;
  taskId?: string;
  projectId?: string;
}

export function DecisionDialog({
  workspaceId,
  decision,
  prefill,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  decision?: Decision | null;
  prefill?: DecisionPrefill;
  onClose: () => void;
  onSaved: (d: Decision) => void;
}) {
  const { t } = useT();
  const [title, setTitle] = useState(decision?.title ?? prefill?.title ?? "");
  const [reason, setReason] = useState(decision?.reason ?? "");
  const [alternatives, setAlternatives] = useState<{ option: string; whyNot?: string }[]>(decision?.alternatives ?? []);
  const [evidence, setEvidence] = useState(decision?.evidence ?? prefill?.evidence ?? "");
  const [sourceUrl, setSourceUrl] = useState(decision?.sourceUrl ?? "");
  const [decidedAt, setDecidedAt] = useState(decision?.decidedAt ?? new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState<string>(decision?.status ?? "active");
  const [projectId, setProjectId] = useState(decision?.project?.id ?? prefill?.projectId ?? "");
  const [people, setPeople] = useState<string[]>(decision?.people.map((p) => p.id) ?? []);
  const [supersedesId, setSupersedesId] = useState(decision?.supersedes?.id ?? "");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [others, setOthers] = useState<Decision[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ id: string; name: string }[]>(`/api/workspaces/${workspaceId}/projects`).then(setProjects).catch(() => {});
    api.get<{ id: string; name: string }[]>(`/api/workspaces/${workspaceId}/members`).then(setMembers).catch(() => {});
    api.get<Decision[]>(`/api/workspaces/${workspaceId}/decisions?status=active`).then((d) => setOthers(d.filter((x) => x.id !== decision?.id))).catch(() => {});
  }, [workspaceId, decision?.id]);

  async function save() {
    if (!title.trim()) return;
    setSaving(true);
    const body = {
      title: title.trim(),
      reason: reason.trim() || null,
      alternatives: alternatives.filter((a) => a.option.trim()),
      evidence: evidence.trim() || null,
      sourceUrl: sourceUrl.trim() || null,
      decidedAt,
      status,
      projectId: projectId || null,
      people,
      ...(supersedesId && supersedesId !== decision?.supersedes?.id ? { supersedesId } : {}),
      ...(decision ? {} : { wikiPageId: prefill?.wikiPageId ?? null, sourceBlockId: prefill?.sourceBlockId ?? null, taskId: prefill?.taskId ?? null }),
    };
    try {
      const d = decision ? await api.patch<Decision>(`/api/decisions/${decision.id}`, body) : await api.post<Decision>(`/api/workspaces/${workspaceId}/decisions`, body);
      toast.success(t("brain.decision.saved"));
      onSaved(d);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  const sel = "h-8 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{decision ? t("brain.decision.edit") : t("brain.decision.new")}</DialogTitle>
        <div className="mt-3 space-y-3 max-h-[70vh] overflow-y-auto thin-scroll pr-1" data-testid="decision-dialog">
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {t("brain.decision.title")}
            <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("brain.decision.titlePh")} data-testid="decision-title" />
          </label>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {t("brain.decision.reason")}
            <Textarea className="mt-1" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="decision-reason" />
          </label>
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {t("brain.decision.alternatives")}
              <button onClick={() => setAlternatives([...alternatives, { option: "", whyNot: "" }])} className="inline-flex items-center gap-1 text-indigo-600" data-testid="decision-add-alt">
                <Plus size={12} /> {t("common.add")}
              </button>
            </div>
            {alternatives.map((a, i) => (
              <div key={i} className="mt-1 flex gap-1.5">
                <Input value={a.option} placeholder={t("brain.decision.option")} onChange={(e) => setAlternatives(alternatives.map((x, j) => (j === i ? { ...x, option: e.target.value } : x)))} data-testid="decision-alt-option" />
                <Input value={a.whyNot ?? ""} placeholder={t("brain.decision.whyNot")} onChange={(e) => setAlternatives(alternatives.map((x, j) => (j === i ? { ...x, whyNot: e.target.value } : x)))} />
                <button onClick={() => setAlternatives(alternatives.filter((_, j) => j !== i))} className="text-neutral-400 hover:text-red-600 px-1" aria-label={t("common.delete")}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {t("brain.decision.evidence")}
            <Textarea className="mt-1" rows={2} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {t("brain.decision.sourceUrl")}
              <Input className="mt-1" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://… or /w/…" />
            </label>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {t("brain.decision.date")}
              <input type="date" className={`${sel} mt-1`} value={decidedAt} onChange={(e) => setDecidedAt(e.target.value)} />
            </label>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {t("brain.decision.status")}
              <select className={`${sel} mt-1`} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="decision-status">
                {["proposed", "active", "superseded", "revoked"].map((s) => (
                  <option key={s} value={s}>
                    {t(`brain.decisionStatus.${s}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {t("brain.decision.project")}
              <select className={`${sel} mt-1`} value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="decision-project">
                <option value="">—</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 sm:col-span-2">
              {t("brain.decision.supersedes")}
              <select className={`${sel} mt-1`} value={supersedesId} onChange={(e) => setSupersedesId(e.target.value)} data-testid="decision-supersedes">
                <option value="">—</option>
                {others.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.decidedAt} · {d.title}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div>
            <p className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{t("brain.decision.people")}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {members.map((m) => {
                const on = people.includes(m.id);
                return (
                  <button key={m.id} onClick={() => setPeople(on ? people.filter((x) => x !== m.id) : [...people, m.id])} className={`h-7 px-2 rounded-full border text-xs ${on ? "bg-indigo-600 border-indigo-600 text-white" : "border-neutral-300 dark:border-neutral-700"}`} data-testid="decision-person">
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} disabled={saving || !title.trim()} data-testid="decision-save">
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
