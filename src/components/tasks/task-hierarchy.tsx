"use client";
import { useMemo, useState } from "react";
import { ChevronRight, CornerLeftUp, ListTree, Plus, X } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { SearchPicker } from "@/components/ui/search-list";
import { parseFieldConfig } from "@/lib/field-types";
import { cn } from "@/lib/utils";
import type { FieldRow, RecordRow } from "@/types";
import { Cell, type LinkTarget, type Member } from "@/components/grid/cell";
import { getCellValue } from "@/lib/query-engine";
import { QuickTaskDialog } from "./quick-task-dialog";

const parentOf = (r: RecordRow) => (Array.isArray(r.data.sys_parent) ? String((r.data.sys_parent as unknown[])[0] ?? "") : "") || null;
const titleOf = (r: RecordRow, fallback: string) => String(r.data.sys_title ?? "").trim() || fallback;

function shortDate(value: unknown): string {
  const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return m ? `${m[3]}/${m[2]}` : "";
}

/**
 * "Parent task" and "Sub-tasks" of a task, shown on the task page and in the side drawer: the chain of
 * parent tasks (top-level first) and the direct sub-tasks with status, assignees and due date. Both are
 * read from the project's tasks; changes go through the normal task API (which checks the user's rights).
 */
export function TaskHierarchy({
  task,
  tasks,
  fields,
  members,
  canEdit,
  canCreate,
  onOpen,
  onSetParent,
  onAddSubtask,
  onUpdateTask,
  onOpenFull,
  canEditTask,
}: {
  /** Saves fields of a sub-task (status, PIC, completed date, or anything from the quick view). */
  onUpdateTask?: (id: string, patch: Record<string, unknown>) => void;
  /** Opens a task in its full view. */
  onOpenFull?: (id: string) => void;
  /** Whether the user may edit this sub-task (the server checks again). Defaults to `canEdit`. */
  canEditTask?: (task: RecordRow) => boolean;
  task: RecordRow;
  /** Tasks of the task's project (may include the task itself). */
  tasks: RecordRow[];
  fields: FieldRow[];
  members: Member[];
  /** May change this task's parent. */
  canEdit: boolean;
  /** May create tasks in the project (adds sub-tasks). */
  canCreate: boolean;
  onOpen: (id: string) => void;
  onSetParent: (parentId: string | null) => void;
  onAddSubtask: (title: string) => Promise<void>;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const untitled = t("task.untitled");
  /** The sub-task shown in the quick view. */
  const [quickId, setQuickId] = useState<string | null>(null);
  const fieldById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
  // Link columns (Parent task, Depends on) pick from all of the project's tasks, this one included.
  const linkTargets = useMemo(() => {
    const target: LinkTarget = { records: tasks.map((r) => ({ id: r.id, label: titleOf(r, untitled) })) };
    return Object.fromEntries(fields.filter((f) => f.type === "link").map((f) => [f.id, target]));
  }, [tasks, fields, untitled]);
  const editable = (r: RecordRow) => !!onUpdateTask && (canEditTask ? canEditTask(r) : canEdit);
  const byId = useMemo(() => new Map(tasks.map((r) => [r.id, r])), [tasks]);
  const statuses = useMemo(() => {
    const field = fields.find((f) => f.id === "sys_status");
    const options = (parseFieldConfig(field?.config ?? "{}").options ?? []) as { id: string; label: string; color?: string; category?: string }[];
    return new Map(options.map((o) => [o.id, o]));
  }, [fields]);

  // Parent chain, nearest last; stops on missing (deleted / other project) parents and on bad cycles.
  const chain: RecordRow[] = [];
  const seen = new Set([task.id]);
  for (let id = parentOf(task); id && !seen.has(id) && chain.length < 20; ) {
    const parent = byId.get(id);
    if (!parent) break;
    chain.unshift(parent);
    seen.add(id);
    id = parentOf(parent);
  }

  const children = tasks.filter((r) => r.id !== task.id && parentOf(r) === task.id);
  const childCount = (id: string) => tasks.filter((r) => parentOf(r) === id).length;
  const done = children.filter((r) => statuses.get(String(r.data.sys_status ?? ""))?.category === "done").length;

  // A task cannot take itself or one of its own sub-tasks as parent (that would make a loop).
  const descendants = new Set<string>([task.id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const r of tasks) {
      const p = parentOf(r);
      if (p && descendants.has(p) && !descendants.has(r.id)) {
        descendants.add(r.id);
        grew = true;
      }
    }
  }
  const parentOptions = tasks.filter((r) => !descendants.has(r.id)).map((r) => ({ value: r.id, label: titleOf(r, untitled) }));
  const directParent = chain[chain.length - 1];

  async function add() {
    const title = draft.trim();
    if (!title || adding) return;
    setAdding(true);
    try {
      await onAddSubtask(title);
      setDraft("");
    } catch {
      // The caller already showed the error; keep the typed name so it can be retried.
    } finally {
      setAdding(false);
    }
  }

  const sectionTitle = "flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500";
  return (
    <div className="space-y-4" data-testid="task-hierarchy">
      <section aria-labelledby="th-parents">
        <h3 id="th-parents" className={sectionTitle}>
          <CornerLeftUp size={13} /> {t("th.parents")}
        </h3>
        {chain.length ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-sm" data-testid="th-parent-chain">
            {chain.map((p, i) => (
              <span key={p.id} className="inline-flex items-center gap-1">
                {i > 0 ? <ChevronRight size={12} className="text-neutral-300" /> : null}
                <button
                  type="button"
                  onClick={() => onOpen(p.id)}
                  className={cn(
                    "max-w-[260px] truncate rounded-md px-2 py-0.5 hover:underline",
                    p === directParent ? "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 font-medium" : "text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
                  )}
                  title={t("th.open", { name: titleOf(p, untitled) })}
                  data-testid="th-parent"
                >
                  {titleOf(p, untitled)}
                </button>
              </span>
            ))}
            {canEdit ? (
              <button type="button" onClick={() => onSetParent(null)} className="ml-1 inline-flex items-center gap-0.5 text-xs text-neutral-400 hover:text-red-600" data-testid="th-remove-parent">
                <X size={11} /> {t("th.removeParent")}
              </button>
            ) : null}
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-neutral-400">{t("th.noParent")}</p>
        )}
        {canEdit && parentOptions.length ? (
          <div className="mt-1.5 max-w-sm">
            <SearchPicker items={parentOptions} onPick={onSetParent} label={chain.length ? t("th.changeParent") : t("th.pickParent")} placeholder={t("th.searchParent")} testId="th-pick-parent" />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="th-children">
        <h3 id="th-children" className={sectionTitle}>
          <ListTree size={13} /> {t("th.subtasks")} ({children.length})
          {children.length ? <span className="ml-auto font-normal normal-case tracking-normal text-neutral-400">{t("th.done", { done, total: children.length })}</span> : null}
        </h3>
        {children.length ? (
          <ul className="mt-1.5 divide-y divide-neutral-100 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800" data-testid="th-children">
            {onUpdateTask ? (
              <li className="hidden items-center gap-x-1.5 bg-neutral-50 px-1.5 py-1 text-[11px] text-neutral-400 dark:bg-neutral-900 sm:flex" aria-hidden>
                <span className="w-[118px] shrink-0 px-2">{fieldById.get("sys_status")?.name}</span>
                <span className="flex-1 px-1">{t("th.subtasks")}</span>
                <span className="w-[150px] shrink-0 px-2">{t("th.pic")}</span>
                <span className="w-[190px] shrink-0 px-2">{fieldById.get("sys_completed_at")?.name}</span>
                <span className="w-9 shrink-0">{t("th.due")}</span>
              </li>
            ) : null}
            {children.map((c) => {
              const status = statuses.get(String(c.data.sys_status ?? ""));
              const people = ((c.data.sys_assignees as string[] | undefined) ?? []).map((id) => members.find((m) => m.id === id)?.name).filter(Boolean);
              const nested = childCount(c.id);
              const isDone = status?.category === "done";
              const inline = (fieldId: string, width: string, testId: string) => {
                const field = fieldById.get(fieldId);
                if (!field) return null;
                return (
                  <div className={cn("h-8 shrink-0 overflow-hidden rounded hover:bg-neutral-100 dark:hover:bg-neutral-800", width)} data-testid={testId} onClick={(e) => e.stopPropagation()}>
                    <Cell field={field} value={getCellValue(c, field, fields)} record={c} members={members} linkTargets={linkTargets} readOnlyOverride={!editable(c)} onChange={(v) => onUpdateTask?.(c.id, { [fieldId]: v })} />
                  </div>
                );
              };
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1.5 py-1 text-sm sm:flex-nowrap">
                  {onUpdateTask ? (
                    inline("sys_status", "w-[118px]", "th-child-status")
                  ) : (
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: status?.color ?? "#a3a3a3" }} title={status?.label} />
                  )}
                  <button
                    type="button"
                    onClick={() => (onUpdateTask ? setQuickId(c.id) : onOpen(c.id))}
                    className={cn("min-w-0 flex-1 truncate px-1 text-left hover:text-indigo-600 hover:underline", isDone && "text-neutral-400 line-through")}
                    title={titleOf(c, untitled)}
                    data-testid="th-child"
                  >
                    {titleOf(c, untitled)}
                  </button>
                  {nested ? <span className="shrink-0 text-[11px] text-neutral-400">{t("th.nested", { n: nested })}</span> : null}
                  {onUpdateTask ? (
                    <>
                      {inline("sys_assignees", "w-[150px]", "th-child-pic")}
                      {inline("sys_completed_at", "w-[190px]", "th-child-completed")}
                    </>
                  ) : (
                    <>
                      {status ? <span className="hidden shrink-0 text-[11px] text-neutral-500 sm:inline">{status.label}</span> : null}
                      {people.length ? <span className="hidden max-w-[140px] shrink-0 truncate text-[11px] text-neutral-500 sm:inline">{people.join(", ")}</span> : null}
                    </>
                  )}
                  {shortDate(c.data.sys_due_date) ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-neutral-400" title={t("th.due")}>
                      {shortDate(c.data.sys_due_date)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-1.5 text-xs text-neutral-400">{t("th.noSubtasks")}</p>
        )}
        {canCreate ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void add();
                }
              }}
              maxLength={200}
              placeholder={t("th.newSubtask")}
              className="h-8 flex-1 rounded-md border border-neutral-200 bg-white px-2 text-sm outline-none focus:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900"
              data-testid="th-new-subtask"
            />
            <button type="button" onClick={() => void add()} disabled={!draft.trim() || adding} className="inline-flex h-8 items-center gap-1 rounded-md border border-neutral-200 px-2 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 dark:border-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-800" data-testid="th-add-subtask">
              <Plus size={12} /> {t("th.add")}
            </button>
          </div>
        ) : null}
      </section>
      {quickId && byId.get(quickId) ? (
        <QuickTaskDialog
          record={byId.get(quickId)!}
          fields={fields}
          members={members}
          linkTargets={linkTargets}
          canEdit={editable(byId.get(quickId)!)}
          onChange={(patch) => onUpdateTask?.(quickId, patch)}
          onOpenFull={() => {
            const id = quickId;
            setQuickId(null);
            (onOpenFull ?? onOpen)(id);
          }}
          onClose={() => setQuickId(null)}
        />
      ) : null}
    </div>
  );
}
