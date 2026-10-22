"use client";
import { useEffect, useState } from "react";
import { Sparkles, X, Plus, Loader2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { DateInput } from "@/components/ui/date-input";
import { useT } from "@/components/i18n-provider";
import type { RecordRow } from "@/types";

type Priority = "low" | "medium" | "high" | "critical";
interface Suggestion {
  suggest: boolean;
  reason?: string;
  why?: string;
  draft?: { title: string; description: string; projectId: string; dueDate: string | null; priority: Priority; assigneeIds: string[]; asSubtask: boolean };
  projects?: { id: string; name: string }[];
  members?: { id: string; name: string }[];
  source?: { taskId: string; projectId: string; taskTitle: string };
}

/**
 * Shown under a comment the user just posted: the AI checks whether it asks for new work and, if so,
 * proposes a task the user can edit and confirm. Nothing is created without the user's click; the
 * task is created through the normal task API (which checks the user's rights in that project).
 * When there is no proposal (or AI is off) the card disappears without a word.
 */
export function CommentTaskSuggestion({ taskId, commentId, onDone, onCreated }: { taskId: string; commentId: string; onDone: () => void; onCreated?: (record: RecordRow) => void }) {
  const { t } = useT();
  const [state, setState] = useState<"loading" | "ready" | "saving">("loading");
  const [s, setS] = useState<Suggestion | null>(null);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const [due, setDue] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>("medium");
  const [assignees, setAssignees] = useState<string[]>([]);
  const [asSubtask, setAsSubtask] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .post<Suggestion>(`/api/tasks/${taskId}/comments/${commentId}/task-suggestion`)
      .then((r) => {
        if (cancelled) return;
        if (!r.suggest || !r.draft) return onDone();
        setS(r);
        setTitle(r.draft.title);
        setProjectId(r.draft.projectId);
        setDue(r.draft.dueDate);
        setPriority(r.draft.priority);
        setAssignees(r.draft.assigneeIds);
        setAsSubtask(r.draft.asSubtask);
        setState("ready");
      })
      .catch(() => !cancelled && onDone());
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one check per posted comment
  }, [taskId, commentId]);

  if (state === "loading")
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-neutral-400" data-testid="comment-ai-checking">
        <Loader2 size={11} className="animate-spin" /> {t("cts.checking")}
      </div>
    );
  if (!s?.draft) return null;

  const sameProject = projectId === s.source?.projectId;
  const memberName = (id: string) => s.members?.find((m) => m.id === id)?.name ?? id;
  const projectName = s.projects?.find((p) => p.id === projectId)?.name ?? "";

  async function create() {
    if (!title.trim() || !projectId) return;
    setState("saving");
    try {
      const data: Record<string, unknown> = {
        sys_title: title.trim(),
        sys_description: s!.draft!.description,
        sys_priority: priority,
        sys_assignees: assignees,
      };
      if (due) data.sys_due_date = due;
      if (asSubtask && sameProject) data.sys_parent = [taskId];
      const record = await api.post<RecordRow>(`/api/projects/${projectId}/tasks`, { data });
      toast.success(t("cts.created", { name: projectName }));
      onCreated?.(record);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      setState("ready");
    }
  }

  return (
    <div className="rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50/60 dark:bg-indigo-950/30 p-3 text-xs space-y-2" data-testid="comment-task-suggestion">
      <div className="flex items-start gap-1.5">
        <Sparkles size={13} className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
        <div className="flex-1">
          <div className="font-medium text-neutral-800 dark:text-neutral-100">{t("cts.title")}</div>
          {s.why ? <div className="text-neutral-500">{s.why}</div> : null}
        </div>
        <button type="button" onClick={onDone} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" aria-label={t("cts.dismiss")}>
          <X size={14} />
        </button>
      </div>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="h-8 text-sm" aria-label={t("cts.taskTitle")} data-testid="cts-title" />
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-0.5">
          <span className="text-neutral-500">{t("cts.project")}</span>
          <Select
            className="w-full"
            value={projectId}
            onValueChange={(v) => {
              setProjectId(v);
              if (v !== s.source?.projectId) setAsSubtask(false);
            }}
            options={(s.projects ?? []).map((p) => ({ value: p.id, label: p.name }))}
            data-testid="cts-project"
          />
        </label>
        <label className="space-y-0.5">
          <span className="text-neutral-500">{t("cts.due")}</span>
          <DateInput value={due} onCommit={setDue} className="h-9 w-full rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 text-sm" />
        </label>
        <label className="space-y-0.5">
          <span className="text-neutral-500">{t("cts.priority")}</span>
          <Select
            className="w-full"
            value={priority}
            onValueChange={(v) => setPriority(v as Priority)}
            options={(["low", "medium", "high", "critical"] as const).map((p) => ({ value: p, label: t(`cts.prio.${p}`) }))}
          />
        </label>
        <div className="space-y-0.5">
          <span className="text-neutral-500">{t("cts.assignees")}</span>
          <div className="flex flex-wrap items-center gap-1">
            {assignees.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-2 py-0.5">
                {memberName(id)}
                <button type="button" onClick={() => setAssignees((a) => a.filter((x) => x !== id))} aria-label={t("cts.removeAssignee", { name: memberName(id) })}>
                  <X size={10} />
                </button>
              </span>
            ))}
            <Select
              className="h-7 w-32"
              value=""
              onValueChange={(v) => v && setAssignees((a) => (a.includes(v) ? a : [...a, v]))}
              options={[{ value: "", label: `+ ${t("cts.addAssignee")}` }, ...(s.members ?? []).filter((m) => !assignees.includes(m.id)).map((m) => ({ value: m.id, label: m.name }))]}
            />
          </div>
        </div>
      </div>
      <label className={sameProject ? "flex items-center gap-2" : "flex items-center gap-2 opacity-50"}>
        <input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={asSubtask && sameProject} disabled={!sameProject} onChange={(e) => setAsSubtask(e.target.checked)} data-testid="cts-subtask" />
        {t("cts.asSubtask", { task: s.source?.taskTitle ?? "" })}
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone} disabled={state === "saving"}>
          {t("cts.dismiss")}
        </Button>
        <Button onClick={create} disabled={state === "saving" || !title.trim()} data-testid="cts-create">
          <Plus size={13} /> {t("cts.create")}
        </Button>
      </div>
    </div>
  );
}
