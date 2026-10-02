"use client";
// Actions on highlighted wiki text: Ask AI, convert to task (or recurring
// task), link an Objective / KR, reminder, copy block link, highlight into the
// page's layers, record a decision.
import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Sparkles, CheckSquare, Repeat, Target, BellRing, Link as LinkIcon, Highlighter, Gavel } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { blockIdAtSelection } from "@/components/editor/block-id";
import { LinkPicker, type LinkTarget } from "./link-picker";
import { DecisionDialog } from "./decision-dialog";

export interface SelectionInfo {
  text: string;
  blockId: string | null;
}

type Action = "task" | "recurring" | "reminder" | "decision" | "okr" | null;

export function useSelectionActions(o: { editor: Editor | null; canEdit: boolean }) {
  const [action, setAction] = useState<Action>(null);
  const [sel, setSel] = useState<SelectionInfo>({ text: "", blockId: null });
  const [range, setRange] = useState<{ from: number; to: number } | null>(null);

  function capture(assignBlock: boolean): SelectionInfo {
    const ed = o.editor;
    if (!ed) return { text: "", blockId: null };
    const { from, to } = ed.state.selection;
    const text = ed.state.doc.textBetween(from, to, " ").trim();
    const blockId = blockIdAtSelection(ed, assignBlock && o.canEdit);
    setRange({ from, to });
    const info = { text, blockId };
    setSel(info);
    return info;
  }

  /** Inserts a link right after the selection (e.g. to the task just created). */
  function appendLink(label: string, href: string) {
    const ed = o.editor;
    if (!ed || !ed.isEditable || !range) return;
    ed.chain().focus().setTextSelection(range.to).insertContent([{ type: "text", text: " ➜ " }, { type: "text", text: label, marks: [{ type: "link", attrs: { href } }] }]).run();
  }

  return { action, setAction, sel, capture, appendLink, range };
}

export function SelectionBar({
  editor,
  canEdit,
  pageHref,
  pageId,
  onOpen,
  onAskAi,
  onHighlighted,
}: {
  editor: Editor;
  canEdit: boolean;
  pageHref: string;
  pageId: string;
  onOpen: (a: Exclude<Action, null>, assignBlock: boolean) => void;
  onAskAi: (text: string) => void;
  onHighlighted: () => void;
}) {
  const { t } = useT();
  const btn = "h-7 px-2 inline-flex items-center gap-1 rounded-md text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap";

  async function copyBlockLink() {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, " ").trim();
    const id = blockIdAtSelection(editor, canEdit);
    const origin = window.location.origin;
    // Readers can't add a block id: fall back to a text-fragment link.
    const url = id ? `${origin}${pageHref}#b-${id}` : `${origin}${pageHref}#:~:text=${encodeURIComponent(text.slice(0, 80))}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("brain.sel.linkCopied"));
    } catch {
      prompt(t("brain.sel.copyLink"), url);
    }
  }
  async function highlight() {
    const { from, to } = editor.state.selection;
    const text = editor.state.doc.textBetween(from, to, " ").trim();
    if (!text) return;
    const id = blockIdAtSelection(editor, true);
    try {
      await api.put(`/api/wiki/${pageId}/layers`, { addHighlight: { text: text.slice(0, 2000), ...(id ? { blockId: id } : {}) } });
      editor.chain().focus().setHighlight().run();
      toast.success(t("brain.sel.highlighted"));
      onHighlighted();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  return (
    <div className="flex items-center gap-0.5 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-lg p-1" data-testid="selection-bar" onMouseDown={(e) => e.preventDefault()}>
      <button className={btn} onClick={() => onAskAi(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " "))} data-testid="sel-ask-ai">
        <Sparkles size={13} className="text-indigo-600" /> {t("brain.sel.askAi")}
      </button>
      <button className={btn} onClick={() => onOpen("task", true)} data-testid="sel-to-task">
        <CheckSquare size={13} /> {t("brain.sel.toTask")}
      </button>
      <button className={btn} onClick={() => onOpen("recurring", true)} data-testid="sel-recurring">
        <Repeat size={13} /> {t("brain.sel.recurring")}
      </button>
      {canEdit && (
        <button className={btn} onClick={() => onOpen("okr", false)} data-testid="sel-okr">
          <Target size={13} /> {t("brain.sel.linkOkr")}
        </button>
      )}
      <button className={btn} onClick={() => onOpen("reminder", true)} data-testid="sel-reminder">
        <BellRing size={13} /> {t("brain.sel.reminder")}
      </button>
      <button className={btn} onClick={copyBlockLink} data-testid="sel-block-link">
        <LinkIcon size={13} /> {t("brain.sel.blockLink")}
      </button>
      {canEdit && (
        <button className={btn} onClick={highlight} data-testid="sel-highlight">
          <Highlighter size={13} /> {t("brain.sel.highlight")}
        </button>
      )}
      <button className={btn} onClick={() => onOpen("decision", true)} data-testid="sel-decision">
        <Gavel size={13} /> {t("brain.sel.decision")}
      </button>
    </div>
  );
}

export function ToTaskDialog({
  workspaceId,
  pageId,
  selection,
  recurring,
  onClose,
  onCreated,
}: {
  workspaceId: string;
  pageId: string;
  selection: SelectionInfo;
  recurring: boolean;
  onClose: () => void;
  onCreated: (task: { id: string; href: string; title: string }) => void;
}) {
  const { t } = useT();
  const [title, setTitle] = useState(selection.text.replace(/\s+/g, " ").slice(0, 200));
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [projectId, setProjectId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [assignToMe, setAssignToMe] = useState(true);
  const [freq, setFreq] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [interval, setInterval] = useState(1);
  const [okr, setOkr] = useState<LinkTarget | null>(null);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<{ id: string; name: string }[]>(`/api/workspaces/${workspaceId}/projects`)
      .then((p) => {
        setProjects(p);
        setProjectId((x) => x || p[0]?.id || "");
      })
      .catch(() => {});
  }, [workspaceId]);

  async function create() {
    if (!title.trim() || !projectId) return;
    setSaving(true);
    try {
      const r = await api.post<{ id: string; href: string }>(`/api/wiki/${pageId}/to-task`, {
        projectId,
        title: title.trim(),
        text: selection.text,
        ...(selection.blockId ? { blockId: selection.blockId } : {}),
        dueDate: dueDate || null,
        assignToMe,
        recurrence: recurring ? { freq, interval } : null,
        okr: okr ? `${okr.type === "kr" ? "kr" : "obj"}:${okr.id}` : null,
      });
      toast.success(recurring ? t("brain.task.recurringCreated") : t("brain.task.created"));
      onCreated({ ...r, title: title.trim() });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  const sel = "h-8 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{recurring ? t("brain.task.recurringTitle") : t("brain.task.title")}</DialogTitle>
        <div className="mt-3 space-y-3" data-testid="to-task-dialog">
          {selection.text && <blockquote className="border-l-2 border-indigo-300 pl-2 text-xs text-neutral-500 line-clamp-3">{selection.text}</blockquote>}
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {t("brain.task.name")}
            <Input className="mt-1" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="to-task-title" />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {t("brain.task.project")}
              <select className={`${sel} mt-1`} value={projectId} onChange={(e) => setProjectId(e.target.value)} data-testid="to-task-project">
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
              {t("brain.task.due")}
              <input type="date" className={`${sel} mt-1`} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </label>
          </div>
          {recurring && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-neutral-600 dark:text-neutral-300 font-medium">{t("brain.task.repeat")}</span>
              <span>{t("brain.task.every")}</span>
              <Input type="number" min={1} max={365} value={interval} onChange={(e) => setInterval(Math.max(1, Number(e.target.value) || 1))} className="w-16 h-8" data-testid="to-task-interval" />
              <select className="h-8 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2" value={freq} onChange={(e) => setFreq(e.target.value as typeof freq)} data-testid="to-task-freq">
                {(["daily", "weekly", "monthly"] as const).map((f) => (
                  <option key={f} value={f}>
                    {t(`brain.task.freq.${f}`)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="relative text-xs">
            <span className="font-medium text-neutral-600 dark:text-neutral-300">{t("brain.task.okr")}</span>{" "}
            {okr ? (
              <span className="inline-flex items-center gap-1">
                {okr.label}
                <button onClick={() => setOkr(null)} className="text-neutral-400">
                  ×
                </button>
              </span>
            ) : (
              <button onClick={() => setPicking(true)} className="text-indigo-600 hover:underline" data-testid="to-task-pick-okr">
                {t("brain.task.pickOkr")}
              </button>
            )}
            {picking && (
              <div className="absolute z-50 mt-1">
                <LinkPicker
                  workspaceId={workspaceId}
                  types={["objective", "kr"]}
                  onPick={(x) => {
                    setOkr(x);
                    setPicking(false);
                  }}
                  onClose={() => setPicking(false)}
                />
              </div>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={assignToMe} onChange={(e) => setAssignToMe(e.target.checked)} /> {t("brain.task.assignMe")}
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={create} disabled={saving || !title.trim() || !projectId} data-testid="to-task-create">
            {t("common.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ReminderDialog({ pageId, selection, onClose }: { pageId: string; selection: SelectionInfo; onClose: () => void }) {
  const { t } = useT();
  // Default: tomorrow 09:00 local time.
  const [at, setAt] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [note, setNote] = useState("");
  async function save() {
    try {
      await api.post(`/api/wiki/${pageId}/reminder`, { at: new Date(at).toISOString(), text: selection.text, note: note.trim() || undefined, ...(selection.blockId ? { blockId: selection.blockId } : {}) });
      toast.success(t("brain.reminder.set", { when: new Date(at).toLocaleString() }));
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>{t("brain.reminder.title")}</DialogTitle>
        <div className="mt-3 space-y-3" data-testid="reminder-dialog">
          {selection.text && <blockquote className="border-l-2 border-indigo-300 pl-2 text-xs text-neutral-500 line-clamp-3">{selection.text}</blockquote>}
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {t("brain.reminder.when")}
            <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="mt-1 h-8 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 text-sm" data-testid="reminder-at" />
          </label>
          <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-300">
            {t("brain.reminder.note")}
            <Input className="mt-1" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={save} data-testid="reminder-save">
            {t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** All dialogs for the selection actions of one wiki page. */
export function SelectionDialogs({
  state,
  workspaceId,
  pageId,
  editor,
}: {
  state: ReturnType<typeof useSelectionActions>;
  workspaceId: string;
  pageId: string;
  editor: Editor | null;
}) {
  const { action, setAction, sel, appendLink, range } = state;
  if (action === "task" || action === "recurring")
    return (
      <ToTaskDialog
        workspaceId={workspaceId}
        pageId={pageId}
        selection={sel}
        recurring={action === "recurring"}
        onClose={() => setAction(null)}
        onCreated={(task) => {
          appendLink(task.title, task.href);
          setAction(null);
        }}
      />
    );
  if (action === "reminder") return <ReminderDialog pageId={pageId} selection={sel} onClose={() => setAction(null)} />;
  if (action === "decision")
    return (
      <DecisionDialog
        workspaceId={workspaceId}
        prefill={{ title: sel.text.replace(/\s+/g, " ").slice(0, 300), evidence: sel.text, wikiPageId: pageId, sourceBlockId: sel.blockId ?? undefined }}
        onClose={() => setAction(null)}
        onSaved={(d) => {
          appendLink(d.title, d.href!);
          setAction(null);
        }}
      />
    );
  if (action === "okr" && editor && range) {
    const c = editor.view.coordsAtPos(range.to);
    return (
      <LinkPicker
        workspaceId={workspaceId}
        types={["objective", "kr"]}
        position={{ left: c.left, top: c.bottom + 6 }}
        onPick={(x) => {
          editor.chain().focus().setTextSelection(range).extendMarkRange("link").setLink({ href: x.href }).run();
          setAction(null);
        }}
        onClose={() => setAction(null)}
      />
    );
  }
  return null;
}
