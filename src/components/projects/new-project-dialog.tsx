"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Target, KeySquare } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { ProjectIconPicker } from "./project-icon";

const COLORS = ["#6366f1", "#0ea5e9", "#22c55e", "#f97316", "#ec4899", "#eab308", "#14b8a6", "#8b5cf6", "#ef4444", "#64748b"];

interface ObjectiveDraft {
  title: string;
  keyResults: string[];
}

/** Project creation: name, color, the project's own categories and (optionally) its objectives + key results. */
export function NewProjectDialog({ open, onOpenChange, workspaceId, workspaceSlug }: { open: boolean; onOpenChange: (v: boolean) => void; workspaceId: string; workspaceSlug: string }) {
  const { t } = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [icon, setIcon] = useState<string | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [categoryDraft, setCategoryDraft] = useState("");
  const [objectives, setObjectives] = useState<ObjectiveDraft[]>([]);
  const [busy, setBusy] = useState(false);

  function reset() {
    setName("");
    setIcon(null);
    setColor(COLORS[0]);
    setCategories([]);
    setCategoryDraft("");
    setObjectives([]);
    setBusy(false);
  }

  function addCategory() {
    const v = categoryDraft.trim();
    if (v && !categories.some((c) => c.toLowerCase() === v.toLowerCase())) setCategories([...categories, v]);
    setCategoryDraft("");
  }

  function updateObjective(i: number, patch: Partial<ObjectiveDraft>) {
    setObjectives((prev) => prev.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const pending = categoryDraft.trim();
      const cats = pending && !categories.includes(pending) ? [...categories, pending] : categories;
      const project = await api.post<{ id: string }>(`/api/workspaces/${workspaceId}/projects`, {
        name: name.trim(),
        color,
        icon,
        categories: cats.map((c) => ({ name: c })),
      });
      for (const o of objectives.filter((x) => x.title.trim())) {
        await api.post(`/api/workspaces/${workspaceId}/objectives`, {
          title: o.title.trim(),
          projectId: project.id,
          keyResults: o.keyResults.filter((k) => k.trim()).map((k) => ({ title: k.trim() })),
        });
      }
      onOpenChange(false);
      reset();
      router.push(`/w/${workspaceSlug}/p/${project.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogTitle>{t("project.new.title")}</DialogTitle>
        <div className="space-y-5">
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block" htmlFor="np-name">{t("project.new.name")}</label>
            <Input id="np-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("project.new.namePlaceholder")} maxLength={160} data-testid="new-project-name" />
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <ProjectIconPicker value={icon} onChange={setIcon} />
              {COLORS.map((c) => (
                <button key={c} onClick={() => setColor(c)} className="h-5 w-5 rounded-full ring-offset-2 ring-offset-white dark:ring-offset-neutral-900" style={{ backgroundColor: c, boxShadow: color === c ? `0 0 0 2px ${c}` : undefined }} aria-label={c} />
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium text-neutral-500 mb-1">{t("project.new.categories")}</div>
            <p className="text-[11px] text-neutral-400 mb-2">{t("project.new.categoriesHint")}</p>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {categories.map((c, i) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-white" style={{ backgroundColor: COLORS[i % COLORS.length] }}>
                  {c}
                  <button onClick={() => setCategories(categories.filter((x) => x !== c))} aria-label={t("common.remove")}>
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
            <Input
              value={categoryDraft}
              onChange={(e) => setCategoryDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addCategory();
                }
              }}
              onBlur={addCategory}
              placeholder={t("project.new.categoryPlaceholder")}
              maxLength={80}
              data-testid="new-project-category"
            />
          </div>

          <div>
            <div className="text-xs font-medium text-neutral-500 mb-1">{t("project.new.objectives")}</div>
            <p className="text-[11px] text-neutral-400 mb-2">{t("project.new.objectivesHint")}</p>
            <div className="space-y-3">
              {objectives.map((o, i) => (
                <div key={i} className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-2.5 space-y-2">
                  <div className="flex items-center gap-2">
                    <Target size={14} className="text-indigo-500 shrink-0" />
                    <Input value={o.title} onChange={(e) => updateObjective(i, { title: e.target.value })} placeholder={t("project.new.objectivePlaceholder")} maxLength={300} data-testid={`new-objective-${i}`} />
                    <button onClick={() => setObjectives(objectives.filter((_, idx) => idx !== i))} className="text-neutral-400 hover:text-red-600" aria-label={t("common.remove")}>
                      <X size={14} />
                    </button>
                  </div>
                  {o.keyResults.map((k, ki) => (
                    <div key={ki} className="flex items-center gap-2 pl-5">
                      <KeySquare size={13} className="text-teal-500 shrink-0" />
                      <Input
                        value={k}
                        onChange={(e) => updateObjective(i, { keyResults: o.keyResults.map((x, xi) => (xi === ki ? e.target.value : x)) })}
                        placeholder={t("project.new.krPlaceholder")}
                        maxLength={300}
                        data-testid={`new-kr-${i}-${ki}`}
                      />
                      <button onClick={() => updateObjective(i, { keyResults: o.keyResults.filter((_, xi) => xi !== ki) })} className="text-neutral-400 hover:text-red-600" aria-label={t("common.remove")}>
                        <X size={13} />
                      </button>
                    </div>
                  ))}
                  <button onClick={() => updateObjective(i, { keyResults: [...o.keyResults, ""] })} className="pl-5 text-xs text-indigo-600 hover:underline">
                    {t("project.new.addKr")}
                  </button>
                </div>
              ))}
              <button onClick={() => setObjectives([...objectives, { title: "", keyResults: [""] }])} className="text-xs text-indigo-600 hover:underline" data-testid="new-project-add-objective">
                {t("project.new.addObjective")}
              </button>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button onClick={create} disabled={!name.trim() || busy} data-testid="new-project-create">{t("project.new.create")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
