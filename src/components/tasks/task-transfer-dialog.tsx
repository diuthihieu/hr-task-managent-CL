"use client";
import { useEffect, useState } from "react";
import { ArrowRightLeft, CopyPlus } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

export type TaskTransferMode = "move" | "duplicate";

type Action = "reuse" | "create" | "skip";
interface Plan {
  tasks: number;
  subtasks: number;
  comments: number;
  files: number;
  fields: { name: string; type: string; action: Action }[];
  categories: { name: string; action: Action }[];
  detached: number;
  droppedLinks: number;
  filesAvailable: boolean;
}
export interface TaskTransferResult {
  tasks: number;
  subtasks: number;
  files?: number;
  filesFailed?: number;
  taskIds: string[];
}

/**
 * Move or duplicate the selected tasks into another project (duplicate may also target this project).
 * Every choice is previewed by the server first (dry run): sub-tasks that come along, which columns and
 * categories are reused / created / left out, links that cannot follow.
 */
export function TaskTransferDialog({
  open,
  onOpenChange,
  initialMode,
  taskIds,
  sourceProjectId,
  workspaceId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode: TaskTransferMode;
  taskIds: string[];
  sourceProjectId: string;
  workspaceId: string;
  onDone: (mode: TaskTransferMode, targetProjectId: string, result: TaskTransferResult) => void;
}) {
  const { t } = useT();
  const [mode, setMode] = useState<TaskTransferMode>(initialMode);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [target, setTarget] = useState("");
  const [comments, setComments] = useState(true);
  const [files, setFiles] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.get<{ id: string; name: string }[]>(`/api/workspaces/${workspaceId}/projects`).then(setProjects).catch(() => setProjects([]));
  }, [open, workspaceId]);

  // Re-preview whenever a choice changes.
  const key = `${open}|${mode}|${target}|${comments}|${files}|${taskIds.join(",")}`;
  const [lastKey, setLastKey] = useState("");
  if (key !== lastKey) {
    setLastKey(key);
    setPlan(null);
    setPlanError("");
  }
  useEffect(() => {
    if (!open || !target || (mode === "move" && target === sourceProjectId)) return;
    let cancelled = false;
    api
      .post<Plan>("/api/tasks/transfer", { sourceProjectId, targetProjectId: target, taskIds, mode, includeComments: comments, includeFiles: files, dryRun: true })
      .then((p) => !cancelled && setPlan(p))
      .catch((e) => !cancelled && setPlanError(e instanceof Error ? e.message : t("common.failed")));
    return () => {
      cancelled = true;
    };
  }, [open, mode, target, comments, files, taskIds, sourceProjectId, t]);

  const options = projects.filter((p) => mode === "duplicate" || p.id !== sourceProjectId).map((p) => ({ value: p.id, label: p.id === sourceProjectId ? `${p.name} (${t("tt.thisProject")})` : p.name }));

  async function run() {
    if (!plan || !target) return;
    setBusy(true);
    try {
      const r = await api.post<TaskTransferResult>("/api/tasks/transfer", { sourceProjectId, targetProjectId: target, taskIds, mode, includeComments: comments, includeFiles: files });
      const name = projects.find((p) => p.id === target)?.name ?? "";
      toast.success(t(mode === "move" ? "tt.moved" : "tt.duplicated", { n: r.tasks + r.subtasks, name }));
      if (r.filesFailed) toast.error(t("tt.filesFailed", { n: r.filesFailed }));
      onDone(mode, target, r);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  const list = (items: { name: string; action: Action }[], action: Action) => items.filter((i) => i.action === action).map((i) => i.name).join(", ");
  const skippedFields = plan ? list(plan.fields, "skip") : "";
  const skippedCats = plan ? list(plan.categories, "skip") : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="task-transfer-dialog">
        <DialogTitle>{t("tt.title", { n: taskIds.length })}</DialogTitle>
        <div className="grid grid-cols-2 gap-2 mb-4" role="radiogroup">
          {(["move", "duplicate"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => {
                setMode(m);
                if (m === "move" && target === sourceProjectId) setTarget("");
              }}
              className={cn(
                "rounded-md border px-3 py-2 text-left text-xs",
                mode === m ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
              )}
              data-testid={`tt-mode-${m}`}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-800 dark:text-neutral-100">
                {m === "move" ? <ArrowRightLeft size={14} /> : <CopyPlus size={14} />}
                {t(m === "move" ? "tt.move" : "tt.duplicate")}
              </span>
              <span className="text-neutral-500">{t(m === "move" ? "tt.moveHint" : "tt.duplicateHint")}</span>
            </button>
          ))}
        </div>

        <label className="block text-xs font-medium mb-1">{t("tt.target")}</label>
        <Select className="w-full" value={target} onValueChange={setTarget} options={[{ value: "", label: t("tt.pick") }, ...options]} data-testid="tt-target" />

        {mode === "duplicate" && (
          <div className="mt-3 space-y-1.5 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={comments} onChange={(e) => setComments(e.target.checked)} data-testid="tt-comments" />
              {t("tt.withComments")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={files} onChange={(e) => setFiles(e.target.checked)} data-testid="tt-files" />
              {t("tt.withFiles")}
            </label>
          </div>
        )}

        {planError && <p className="mt-3 text-xs text-red-600">{planError}</p>}
        {plan && (
          <div className="mt-3 space-y-1.5 rounded-md bg-neutral-50 dark:bg-neutral-800/50 p-3 text-xs text-neutral-700 dark:text-neutral-300" data-testid="tt-plan">
            <p className="font-medium">{t("tt.counts", { tasks: plan.tasks, subtasks: plan.subtasks })}</p>
            <p>{mode === "move" ? t("tt.moveKeeps", { comments: plan.comments, files: plan.files }) : t("tt.dupCopies", { comments: plan.comments, files: plan.files })}</p>
            {mode === "duplicate" && files && plan.files > 0 && !plan.filesAvailable && <p className="text-amber-700 dark:text-amber-500">{t("tt.noStorage")}</p>}
            {plan.fields.length > 0 && <p>{t("tt.columns", { reuse: list(plan.fields, "reuse") || "—", create: list(plan.fields, "create") || "—" })}</p>}
            {plan.categories.length > 0 && <p>{t("tt.categories", { reuse: list(plan.categories, "reuse") || "—", create: list(plan.categories, "create") || "—" })}</p>}
            {skippedFields && <p className="text-amber-700 dark:text-amber-500">{t("tt.skipColumns", { names: skippedFields })}</p>}
            {skippedCats && <p className="text-amber-700 dark:text-amber-500">{t("tt.skipCategories", { names: skippedCats })}</p>}
            {plan.detached > 0 && <p className="text-amber-700 dark:text-amber-500">{t("tt.detached", { n: plan.detached })}</p>}
            {plan.droppedLinks > 0 && <p className="text-amber-700 dark:text-amber-500">{t("tt.droppedLinks", { n: plan.droppedLinks })}</p>}
            {mode === "duplicate" && <p className="text-neutral-500">{t("tt.dupFresh")}</p>}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!plan || busy} onClick={run} data-testid="tt-run">
            {mode === "move" ? <ArrowRightLeft size={13} /> : <CopyPlus size={13} />}
            {t(mode === "move" ? "tt.runMove" : "tt.runDuplicate")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
