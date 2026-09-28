"use client";
import { useEffect, useState } from "react";
import { Sparkles, Loader2, Copy, ListChecks, ShieldAlert, MessageSquareText, FileText, AlertTriangle, TrendingUp, Link2, PenLine, ClipboardList, ScrollText, BarChart3, Check } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";
import { Markdown, markdownToHtml } from "./markdown";

type Icon = React.ComponentType<{ size?: number; className?: string }>;
export interface AiActionDef {
  action: string;
  label: MessageKey;
  icon: Icon;
  structured?: boolean;
}
interface Item {
  title: string;
  estimateHours: number | null;
  note: string;
}

async function runAction(body: Record<string, unknown>, onText: (t: string) => void, signal: AbortSignal): Promise<Item[] | null> {
  const res = await fetch("/api/ai/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    throw new Error(b.error || `Request failed (${res.status})`);
  }
  if (res.headers.get("content-type")?.includes("application/json")) return ((await res.json()) as { items: Item[] }).items;
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let acc = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    acc += dec.decode(value, { stream: true });
    onText(acc);
  }
  return null;
}

/**
 * The "AI" button embedded in a page: pick an action, see the streamed answer,
 * copy it, or apply it (create sub-tasks, replace a wiki page...).
 */
export function AiActionMenu({
  actions,
  targetId,
  targetKind,
  getData,
  renderApply,
  label,
  className,
  autoAction,
}: {
  /** Run this action right away (e.g. Home ?ai=home_plan from Ctrl+K "Plan my day"). */
  autoAction?: string | null;
  actions: AiActionDef[];
  targetId: string;
  targetKind?: "dashboard" | "project";
  getData?: () => string;
  renderApply?: (ctx: { action: string; text: string; items: Item[] | null; close: () => void }) => React.ReactNode;
  label?: string;
  className?: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState<AiActionDef | null>(null);
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abort, setAbort] = useState<AbortController | null>(null);

  async function start(a: AiActionDef) {
    abort?.abort();
    const ctrl = new AbortController();
    setAbort(ctrl);
    setOpen(a);
    setText("");
    setItems(null);
    setError(null);
    setBusy(true);
    try {
      const r = await runAction({ action: a.action, targetId, ...(targetKind ? { targetKind } : {}), ...(getData ? { data: getData().slice(0, 60000) } : {}) }, setText, ctrl.signal);
      if (r) setItems(r);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  const [autoDone, setAutoDone] = useState(false);
  useEffect(() => {
    const a = autoAction ? actions.find((x) => x.action === autoAction) : undefined;
    if (!a || autoDone) return;
    setAutoDone(true); // eslint-disable-line react-hooks/set-state-in-effect -- one-shot trigger from the URL
    start(a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAction]);

  const close = () => {
    abort?.abort();
    setOpen(null);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className={cn("border-indigo-200 dark:border-indigo-900 text-indigo-700 dark:text-indigo-300", className)} data-testid="ai-actions">
            <Sparkles size={14} /> {label ?? t("aiAct.button")}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-60">
          <DropdownMenuLabel>{t("aiAct.menu")}</DropdownMenuLabel>
          {actions.map((a) => (
            <DropdownMenuItem key={a.action} onSelect={() => start(a)} data-testid={`ai-act-${a.action}`}>
              <a.icon size={14} /> {t(a.label)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={!!open} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-w-2xl">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={16} className="text-indigo-600" /> {open ? t(open.label) : ""}
          </DialogTitle>
          <div className="max-h-[60vh] overflow-y-auto thin-scroll" data-testid="ai-act-result">
            {error ? (
              <div className="rounded-lg bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm px-3 py-2 break-words">{error}</div>
            ) : items ? (
              <ul className="space-y-2">
                {items.map((i, idx) => (
                  <li key={idx} className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2">
                    <div className="text-sm font-medium">{i.title}</div>
                    <div className="text-xs text-neutral-500">
                      {i.estimateHours ? `${i.estimateHours} h · ` : ""}
                      {i.note}
                    </div>
                  </li>
                ))}
              </ul>
            ) : text ? (
              <Markdown text={text} />
            ) : (
              <div className="flex items-center gap-2 text-sm text-neutral-500 py-6 justify-center">
                <Loader2 size={16} className="animate-spin text-indigo-600" /> {t("aiAct.thinking")}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 mt-3">
            {!busy && !error && text && (
              <Button variant="ghost" onClick={() => navigator.clipboard.writeText(text).then(() => toast.success(t("ai.copied")))}>
                <Copy size={13} /> {t("ai.copy")}
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              {!busy && !error && open && renderApply?.({ action: open.action, text, items, close })}
              {error && open && (
                <Button variant="outline" onClick={() => start(open)}>
                  {t("ai.retry")}
                </Button>
              )}
              <Button variant="secondary" onClick={close}>{t("common.close")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

async function createTasks(projectId: string, items: Item[], parentId?: string) {
  for (const i of items)
    await api.post(`/api/projects/${projectId}/tasks`, { data: { sys_title: i.title, ...(i.estimateHours ? { sys_estimate: i.estimateHours } : {}), ...(parentId ? { sys_parent: [parentId] } : {}), ...(i.note ? { sys_description: i.note } : {}) } });
}

export function AiTaskActions({ taskId, projectId, canEdit, onChanged }: { taskId: string; projectId: string; canEdit: boolean; onChanged?: () => void }) {
  const { t } = useT();
  const [creating, setCreating] = useState(false);
  return (
    <AiActionMenu
      targetId={taskId}
      actions={[
        { action: "task_summarize", label: "aiAct.task_summarize", icon: FileText },
        { action: "task_blockers", label: "aiAct.task_blockers", icon: ShieldAlert },
        { action: "task_message", label: "aiAct.task_message", icon: MessageSquareText },
        { action: "task_breakdown", label: "aiAct.task_breakdown", icon: ListChecks, structured: true },
      ]}
      renderApply={({ action, items, close }) =>
        action === "task_breakdown" && items?.length && canEdit ? (
          <Button
            disabled={creating}
            onClick={async () => {
              setCreating(true);
              try {
                await createTasks(projectId, items, taskId);
                toast.success(t("aiAct.subtasksCreated", { count: items.length }));
                onChanged?.();
                close();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : t("common.failed"));
              } finally {
                setCreating(false);
              }
            }}
            data-testid="ai-create-subtasks"
          >
            <Check size={13} /> {t("aiAct.createSubtasks", { count: items.length })}
          </Button>
        ) : null
      }
    />
  );
}

export function AiObjectiveActions({ objectiveId }: { objectiveId: string }) {
  return (
    <AiActionMenu
      targetId={objectiveId}
      actions={[
        { action: "okr_risk", label: "aiAct.okr_risk", icon: AlertTriangle },
        { action: "okr_update", label: "aiAct.okr_update", icon: PenLine },
        { action: "okr_unlinked", label: "aiAct.okr_unlinked", icon: Link2 },
      ]}
    />
  );
}

export function AiWikiActions({ pageId, workspaceId, canEdit, onApplied }: { pageId: string; workspaceId: string; canEdit: boolean; onApplied?: () => void }) {
  const { t } = useT();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get<{ id: string; name: string }[]>(`/api/workspaces/${workspaceId}/projects`).then((p) => {
      setProjects(p);
      setProjectId((prev) => prev || p[0]?.id || "");
    }).catch(() => {});
  }, [workspaceId]);
  return (
    <AiActionMenu
      targetId={pageId}
      actions={[
        { action: "wiki_summarize", label: "aiAct.wiki_summarize", icon: FileText },
        { action: "wiki_rewrite", label: "aiAct.wiki_rewrite", icon: PenLine },
        { action: "wiki_sop", label: "aiAct.wiki_sop", icon: ScrollText },
        { action: "wiki_extract_tasks", label: "aiAct.wiki_extract_tasks", icon: ClipboardList, structured: true },
      ]}
      renderApply={({ action, text, items, close }) => {
        if ((action === "wiki_rewrite" || action === "wiki_sop") && canEdit && text)
          return (
            <Button
              disabled={busy}
              onClick={async () => {
                if (!confirm(t("aiAct.replaceConfirm"))) return;
                setBusy(true);
                try {
                  await api.patch(`/api/wiki/${pageId}`, { content: markdownToHtml(text) });
                  toast.success(t("common.saved"));
                  onApplied?.();
                  close();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : t("common.failed"));
                } finally {
                  setBusy(false);
                }
              }}
              data-testid="ai-replace-page"
            >
              <Check size={13} /> {t("aiAct.replacePage")}
            </Button>
          );
        if (action === "wiki_extract_tasks" && items?.length && projects.length)
          return (
            <div className="flex items-center gap-2">
              <Select className="w-44" value={projectId} onValueChange={setProjectId} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
              <Button
                disabled={busy || !projectId}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await createTasks(projectId, items);
                    toast.success(t("aiAct.tasksCreated", { count: items.length }));
                    close();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : t("common.failed"));
                  } finally {
                    setBusy(false);
                  }
                }}
                data-testid="ai-create-tasks"
              >
                <Check size={13} /> {t("aiAct.createTasks", { count: items.length })}
              </Button>
            </div>
          );
        return null;
      }}
    />
  );
}

export function AiDashboardActions({ dashboardId, projectId, getData }: { dashboardId?: string; projectId?: string; getData: () => string }) {
  return (
    <AiActionMenu
      targetId={(dashboardId ?? projectId)!}
      targetKind={projectId ? "project" : "dashboard"}
      getData={getData}
      label="AI Insight"
      actions={[
        { action: "dash_explain", label: "aiAct.dash_explain", icon: BarChart3 },
        { action: "dash_anomaly", label: "aiAct.dash_anomaly", icon: AlertTriangle },
        { action: "dash_trends", label: "aiAct.dash_trends", icon: TrendingUp },
      ]}
    />
  );
}

/**
 * "Build with AI": describe the dashboard / report you want in plain words;
 * the server turns it into validated widget specs over the real fields.
 */
export function AiBuildWidgetsButton({
  target,
  dashboardId,
  projectId,
  onBuilt,
}: {
  target: "dashboard" | "report";
  dashboardId?: string;
  projectId?: string;
  onBuilt: (widgets: Record<string, unknown>[]) => void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const examples = [t("aiBuild.ex1"), t("aiBuild.ex2"), t("aiBuild.ex3")];

  async function build() {
    if (!prompt.trim()) return;
    setBusy(true);
    try {
      const r = await api.post<{ widgets: Record<string, unknown>[] }>("/api/ai/build-widgets", { target, dashboardId, projectId, prompt: prompt.trim() });
      if (!r.widgets.length) {
        toast.error(t("aiBuild.none"));
        return;
      }
      onBuilt(r.widgets);
      toast.success(t("aiBuild.added", { n: r.widgets.length }));
      setOpen(false);
      setPrompt("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-testid="ai-build">
        <Sparkles size={13} className="text-indigo-500" /> {t("aiBuild.button")}
      </Button>
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="max-w-lg">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles size={15} className="text-indigo-500" /> {t(target === "dashboard" ? "aiBuild.titleDashboard" : "aiBuild.titleReport")}
          </DialogTitle>
          <p className="text-xs text-neutral-500 mt-1">{t("aiBuild.hint")}</p>
          <textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && build()}
            rows={4}
            maxLength={2000}
            placeholder={t("aiBuild.placeholder")}
            data-testid="ai-build-prompt"
            className="mt-3 w-full rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-indigo-400"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {examples.map((ex) => (
              <button key={ex} onClick={() => setPrompt(ex)} className="text-[11px] rounded-full border border-neutral-200 dark:border-neutral-700 px-2 py-0.5 text-neutral-600 dark:text-neutral-300 hover:border-indigo-400">
                {ex}
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button onClick={build} disabled={busy || !prompt.trim()} data-testid="ai-build-submit">
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {t("aiBuild.submit")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
