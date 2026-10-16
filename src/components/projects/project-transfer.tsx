"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/misc";
import { useT } from "@/components/i18n-provider";

type Plan = {
  tasks: number;
  deletedTasks: number;
  comments: number;
  attachments: number;
  objectives: number;
  ideas: number;
  fields: { name: string; type: string; action: "reuse" | "create" }[];
  categories: { name: string; action: "reuse" | "create" }[];
};

/**
 * Move everything of this project (tasks with comments, files, history,
 * sub-tasks; categories and column values; objectives; ideas…) into another
 * project of the workspace. Shows a preview first; the source can be archived.
 */
export function ProjectTransfer({ projectId, workspaceId, workspaceSlug }: { projectId: string; workspaceId: string; workspaceSlug: string }) {
  const { t } = useT();
  const router = useRouter();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [target, setTarget] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [objectives, setObjectives] = useState(true);
  const [archive, setArchive] = useState(true);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<{ id: string; name: string }[]>(`/api/workspaces/${workspaceId}/projects`).then((ps) => setProjects(ps.filter((p) => p.id !== projectId))).catch(() => {});
  }, [workspaceId, projectId]);

  async function pick(id: string) {
    setTarget(id);
    setPlan(null);
    setSure(false);
    if (!id) return;
    try {
      setPlan(await api.get<Plan>(`/api/projects/${projectId}/transfer?targetProjectId=${id}`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function run() {
    if (!target || !sure) return;
    setBusy(true);
    try {
      const r = await api.post<{ tasks: number }>(`/api/projects/${projectId}/transfer`, { targetProjectId: target, includeObjectives: objectives, archiveSource: archive });
      toast.success(t("pt.done", { n: r.tasks }));
      router.push(`/w/${workspaceSlug}/p/${target}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      setBusy(false);
    }
  }

  const targetName = projects.find((p) => p.id === target)?.name ?? "";
  const create = (plan?.fields ?? []).filter((f) => f.action === "create");
  const createCats = (plan?.categories ?? []).filter((c) => c.action === "create");
  return (
    <section className="rounded-lg border border-amber-200 dark:border-amber-900 p-4" data-testid="project-transfer">
      <h2 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50 flex items-center gap-1.5">
        <ArrowRightLeft size={14} className="text-amber-600" /> {t("pt.title")}
      </h2>
      <p className="text-xs text-neutral-500 mt-1 mb-3 max-w-2xl">{t("pt.lead")}</p>
      <label className="block text-xs font-medium mb-1">{t("pt.target")}</label>
      <Select className="w-full max-w-sm" value={target} onValueChange={pick} options={[{ value: "", label: t("pt.pick") }, ...projects.map((p) => ({ value: p.id, label: p.name }))]} data-testid="pt-target" />
      {plan && (
        <div className="mt-3 space-y-2 text-xs max-w-2xl" data-testid="pt-plan">
          <p>{t("pt.counts", { tasks: plan.tasks, deleted: plan.deletedTasks, comments: plan.comments, files: plan.attachments, ideas: plan.ideas })}</p>
          <p className="text-neutral-500">
            {t("pt.columns", { reuse: plan.fields.length - create.length, create: create.length })}
            {create.length ? `: ${create.map((f) => f.name).join(", ")}` : ""}
          </p>
          <p className="text-neutral-500">
            {t("pt.categories", { reuse: plan.categories.length - createCats.length, create: createCats.length })}
            {createCats.length ? `: ${createCats.map((c) => c.name).join(", ")}` : ""}
          </p>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={objectives} onChange={(e) => setObjectives(e.target.checked)} />
            {t("pt.objectives", { n: plan.objectives })}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={archive} onChange={(e) => setArchive(e.target.checked)} />
            {t("pt.archive")}
          </label>
          <p className="text-amber-700 dark:text-amber-500">{t("pt.warn")}</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" checked={sure} onChange={(e) => setSure(e.target.checked)} data-testid="pt-sure" />
            <span>{t("pt.sure", { name: targetName })}</span>
          </label>
          <Button disabled={!sure || busy} onClick={run} data-testid="pt-run">
            <ArrowRightLeft size={13} /> {t("pt.run")}
          </Button>
        </div>
      )}
    </section>
  );
}
