"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Paperclip, Download, Trash2, Send, FileText, MessageSquare, History, ChevronDown, ChevronUp, FileImage, File as FileIcon, Reply } from "lucide-react";
import { Cell } from "@/components/grid/cell";
import type { Member, LinkTarget } from "@/components/grid/cell";
import { RichEditor, type SaveState } from "@/components/editor/rich-editor";
import { Button } from "@/components/ui/button";
import { MentionInput, CommentBody } from "@/components/comments/mention-input";
import { StartFocusButton } from "@/components/focus/focus-mode";
import { AiTaskActions } from "@/components/ai/ai-actions";
import { stripMentions } from "@/lib/mentions";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { getCellValue } from "@/lib/query-engine";
import { api } from "@/lib/api-client";
import { initials, formatDate, cn } from "@/lib/utils";
import type { ActivityRow, AttachmentRow, FieldRow, RecordRow } from "@/types";

interface ProjectDetail {
  id: string;
  name: string;
  fields: FieldRow[];
  members: Member[];
  myRole: string;
}
interface CommentItem {
  id: string;
  body: string;
  parentCommentId: string | null;
  createdAt: string;
  user: { id: string; name: string; avatarColor: string } | null;
}

const ROLE_RANK: Record<string, number> = { viewer: 0, contributor: 1, editor: 2, admin: 3, owner: 4 };
// Shown up front; the rest sits behind "show all fields".
const PRIMARY_FIELDS = ["sys_status", "sys_assignees", "sys_report_to", "sys_priority", "sys_category", "sys_start_date", "sys_due_date", "sys_progress", "sys_objective", "sys_estimate", "sys_actual", "sys_description"];
const HIDDEN_ON_PAGE = new Set(["sys_title", "sys_attachments"]);

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
const isImage = (type: string) => /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(type);

/** A task as a full page (Lark-style): properties, rich page content, attachments, comments and history. */
export function RecordPage({ projectId, taskId, workspaceSlug, currentUserId }: { projectId: string; taskId: string; workspaceSlug: string; currentUserId: string }) {
  const { t } = useT();
  const router = useRouter();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [record, setRecord] = useState<RecordRow | null>(null);
  const [content, setContent] = useState<string | null | undefined>(undefined);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [siblings, setSiblings] = useState<{ id: string; label: string }[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [uploading, setUploading] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<CommentItem | null>(null);
  const [side, setSide] = useState<"comments" | "activity">("comments");
  const fileRef = useRef<HTMLInputElement>(null);
  const tasksHref = `/w/${workspaceSlug}/p/${projectId}`;

  const loadActivity = useCallback(() => {
    api.get<ActivityRow[]>(`/api/tasks/${taskId}/activity`).then(setActivity).catch(() => {});
  }, [taskId]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.get<ProjectDetail>(`/api/projects/${projectId}`), api.get<RecordRow>(`/api/tasks/${taskId}`), api.get<{ content: string | null }>(`/api/tasks/${taskId}/content`)])
      .then(([p, r, c]) => {
        if (cancelled) return;
        setProject(p);
        setRecord(r);
        setContent(c.content);
      })
      .catch(() => !cancelled && setNotFound(true));
    api.get<AttachmentRow[]>(`/api/tasks/${taskId}/attachments`).then((a) => !cancelled && setAttachments(a)).catch(() => {});
    api.get<CommentItem[]>(`/api/tasks/${taskId}/comments`).then((c) => !cancelled && setComments(c)).catch(() => {});
    api
      .get<RecordRow[]>(`/api/projects/${projectId}/tasks`)
      .then((rows) => !cancelled && setSiblings(rows.map((r) => ({ id: r.id, label: String(r.data.sys_title ?? "") }))))
      .catch(() => {});
    loadActivity();
    return () => {
      cancelled = true;
    };
  }, [projectId, taskId, loadActivity]);

  const fields = useMemo(() => project?.fields ?? [], [project]);
  const role = project?.myRole ?? "viewer";
  const canEdit =
    (ROLE_RANK[role] ?? -1) >= ROLE_RANK.editor ||
    (role === "contributor" && !!record && (record.createdById === currentUserId || ((record.data.sys_assignees as string[] | undefined) ?? []).includes(currentUserId)));
  const linkTargets = useMemo(() => {
    const target: LinkTarget = { records: siblings.filter((s) => s.id !== taskId).map((s) => ({ id: s.id, label: s.label || t("common.untitled") })) };
    const out: Record<string, LinkTarget> = {};
    for (const f of fields) if (f.type === "link") out[f.id] = target;
    return out;
  }, [siblings, fields, taskId, t]);

  async function change(fieldId: string, value: unknown) {
    if (!record) return;
    setRecord({ ...record, data: { ...record.data, [fieldId]: value } });
    try {
      const saved = await api.patch<RecordRow>(`/api/tasks/${taskId}`, { data: { [fieldId]: value } });
      setRecord(saved);
      loadActivity();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      api.get<RecordRow>(`/api/tasks/${taskId}`).then(setRecord).catch(() => {});
    }
  }

  async function uploadOne(file: File): Promise<AttachmentRow> {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
    setAttachments((prev) => [body as AttachmentRow, ...prev]);
    return body as AttachmentRow;
  }

  async function upload(files: FileList | File[]) {
    for (const file of [...files]) {
      setUploading(file.name);
      try {
        await uploadOne(file);
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : t("common.failed")}`);
      }
    }
    setUploading(null);
    if (fileRef.current) fileRef.current.value = "";
    loadActivity();
  }

  async function uploadImageForEditor(file: File): Promise<string> {
    const a = await uploadOne(file);
    return `/api/attachments/${a.id}/download?inline=1`;
  }

  async function removeAttachment(a: AttachmentRow) {
    if (!confirm(t("record.removeFile", { name: a.fileName }))) return;
    try {
      await api.delete(`/api/attachments/${a.id}`);
      setAttachments((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function postComment() {
    if (!draft.trim()) return;
    try {
      const c = await api.post<CommentItem>(`/api/tasks/${taskId}/comments`, { body: draft, parentCommentId: replyTo?.id ?? null });
      setComments((prev) => [...prev, c]);
      setDraft("");
      setReplyTo(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function deleteComment(c: CommentItem) {
    if (!confirm(t("record.deleteComment"))) return;
    try {
      await api.delete(`/api/comments/${c.id}`);
      setComments((prev) => prev.filter((x) => x.id !== c.id && x.parentCommentId !== c.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function deleteTask() {
    if (!confirm(t("record.deleteConfirm"))) return;
    try {
      await api.delete(`/api/tasks/${taskId}`);
      router.push(tasksHref);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  if (notFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-neutral-500">
        {t("record.notFound")}
        <Link href={tasksHref} className="text-indigo-600 hover:underline">
          {t("record.backToTable")}
        </Link>
      </div>
    );
  }
  if (!project || !record || content === undefined) return <div className="flex-1 flex items-center justify-center text-sm text-neutral-400">{t("common.loading")}</div>;

  const title = String(record.data.sys_title ?? "");
  const pageFields = fields.filter((f) => !HIDDEN_ON_PAGE.has(f.id));
  const primary = PRIMARY_FIELDS.map((id) => pageFields.find((f) => f.id === id)).filter((f): f is FieldRow => Boolean(f));
  const rest = pageFields.filter((f) => !PRIMARY_FIELDS.includes(f.id));
  const shown = showAll ? [...primary, ...rest] : primary;
  const rootComments = comments.filter((c) => !c.parentCommentId);
  const repliesOf = (id: string) => comments.filter((c) => c.parentCommentId === id);
  const idx = siblings.findIndex((s) => s.id === taskId);
  const canModerate = (ROLE_RANK[role] ?? -1) >= ROLE_RANK.admin;

  const commentView = (c: CommentItem, nested = false): React.ReactNode => (
    <div key={c.id} className={cn("flex gap-2", nested && "ml-8 mt-2")}>
      <span className="h-7 w-7 rounded-full flex items-center justify-center text-white text-[10px] shrink-0" style={{ backgroundColor: c.user?.avatarColor ?? "#94a3b8" }}>
        {initials(c.user?.name ?? "?")}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-xs">
          <span className="font-medium text-neutral-800 dark:text-neutral-100">{c.user?.name ?? "—"}</span> <span className="text-neutral-400">{formatDate(c.createdAt, true)}</span>
        </div>
        <CommentBody body={c.body} className="text-sm text-neutral-700 dark:text-neutral-300" />
        <div className="flex gap-3 text-[11px] text-neutral-400 mt-0.5">
          {!nested && (
            <button onClick={() => setReplyTo(c)} className="hover:text-indigo-600 flex items-center gap-0.5">
              <Reply size={11} /> {t("record.reply")}
            </button>
          )}
          {(c.user?.id === currentUserId || canModerate) && (
            <button onClick={() => deleteComment(c)} className="hover:text-red-600">
              {t("common.delete")}
            </button>
          )}
        </div>
        {!nested && repliesOf(c.id).map((r) => commentView(r, true))}
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden">
      <div className="flex-1 overflow-y-auto thin-scroll">
        <div className="max-w-4xl mx-auto px-6 py-6">
          <div className="flex items-center gap-2 mb-4 text-xs">
            <Link href={tasksHref} className="flex items-center gap-1 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200" data-testid="record-back">
              <ArrowLeft size={13} /> {t("record.backToTable")}
            </Link>
            {idx >= 0 && (
              <span className="ml-auto flex items-center gap-1 text-neutral-400">
                <button disabled={idx <= 0} onClick={() => router.push(`${tasksHref}/t/${siblings[idx - 1].id}`)} className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-30" aria-label="Previous">
                  <ChevronUp size={14} />
                </button>
                {idx + 1}/{siblings.length}
                <button disabled={idx >= siblings.length - 1} onClick={() => router.push(`${tasksHref}/t/${siblings[idx + 1].id}`)} className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-30" aria-label="Next">
                  <ChevronDown size={14} />
                </button>
              </span>
            )}
            {canEdit && (
              <button onClick={deleteTask} className={cn("flex items-center gap-1 text-neutral-400 hover:text-red-600", idx < 0 && "ml-auto")}>
                <Trash2 size={13} /> {t("record.deleteTask")}
              </button>
            )}
          </div>

          <TitleInput value={title} disabled={!canEdit} placeholder={t("record.titlePlaceholder")} onCommit={(v) => change("sys_title", v)} />
          <div className="flex flex-wrap items-center gap-2 mt-3" data-testid="record-actions">
            <StartFocusButton taskId={taskId} />
            <AiTaskActions taskId={taskId} projectId={projectId} canEdit={canEdit} onChanged={() => router.refresh()} />
          </div>
          {!canEdit && <p className="text-xs text-amber-600 mt-1">{t("record.readOnly")}</p>}
          <p className="text-xs text-neutral-400 mt-1">
            {t("record.created", { when: formatDate(record.createdAt, true) })} · {t("common.updated", { when: formatDate(record.updatedAt, true) })}
          </p>

          <section className="mt-5">
            <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-x-3 gap-y-1.5 text-sm">
              {shown.map((field) => (
                <div key={field.id} className="contents">
                  <div className="text-neutral-500 text-xs pt-2 truncate" title={field.name}>
                    {field.name}
                  </div>
                  <div className={cn("rounded-md min-h-[34px] hover:bg-neutral-50 dark:hover:bg-neutral-900", field.id === "sys_description" && "border border-neutral-200 dark:border-neutral-800")}>
                    <Cell
                      field={field}
                      value={getCellValue(record, field, fields)}
                      record={record}
                      members={project.members}
                      linkTargets={linkTargets}
                      readOnlyOverride={!canEdit || field.readOnly}
                      wrapText={field.id === "sys_description"}
                      maxHeight={field.id === "sys_description" ? 240 : undefined}
                      onChange={(v) => change(field.id, v)}
                    />
                  </div>
                </div>
              ))}
            </div>
            {rest.length > 0 && (
              <button onClick={() => setShowAll(!showAll)} className="mt-2 text-xs text-indigo-600 hover:underline flex items-center gap-1">
                {showAll ? <ChevronUp size={12} /> : <ChevronDown size={12} />} {showAll ? t("record.showLess") : t("record.showAll", { count: pageFields.length })}
              </button>
            )}
          </section>

          <section className="mt-8">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={15} className="text-neutral-400" />
              <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">{t("record.content")}</h2>
              <span className="ml-auto text-[11px] text-neutral-400" data-testid="record-save-state">
                {saveState === "saving" ? t("editor.saving") : saveState === "saved" ? t("editor.saved") : saveState === "error" ? t("editor.error") : ""}
              </span>
            </div>
            <RichEditor
              content={content}
              editable={canEdit}
              onSaveStateChange={setSaveState}
              onUploadImage={uploadImageForEditor}
              onSave={async (html) => {
                await api.put(`/api/tasks/${taskId}/content`, { content: html || null });
              }}
            />
          </section>

          <section
            className="mt-8"
            onDragOver={(e) => canEdit && e.preventDefault()}
            onDrop={(e) => {
              if (!canEdit || !e.dataTransfer.files.length) return;
              e.preventDefault();
              upload(e.dataTransfer.files);
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Paperclip size={15} className="text-neutral-400" />
              <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
                {t("record.attachments")} <span className="text-neutral-400 font-normal">({attachments.length})</span>
              </h2>
              {canEdit && (
                <>
                  <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} data-testid="record-file-input" />
                  <Button size="sm" variant="secondary" className="ml-auto" onClick={() => fileRef.current?.click()} disabled={!!uploading}>
                    <Paperclip size={12} /> {uploading ? t("record.uploading", { name: uploading }) : t("record.attach")}
                  </Button>
                </>
              )}
            </div>
            {canEdit && <p className="text-[11px] text-neutral-400 mb-2">{t("record.attachHint")}</p>}
            {attachments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-6 text-center text-xs text-neutral-400">{t("record.noAttachments")}</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {attachments.map((a) => (
                  <div key={a.id} className="group rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden bg-white dark:bg-neutral-900" data-testid="record-attachment">
                    {isImage(a.contentType) ? (
                      <a href={`${a.downloadUrl}?inline=1`} target="_blank" rel="noreferrer" className="block h-28 bg-neutral-100 dark:bg-neutral-800">
                        {/* eslint-disable-next-line @next/next/no-img-element -- authorized, private attachment route */}
                        <img src={`${a.downloadUrl}?inline=1`} alt={a.fileName} className="h-full w-full object-cover" loading="lazy" />
                      </a>
                    ) : (
                      <div className="h-28 flex items-center justify-center bg-neutral-50 dark:bg-neutral-800/50 text-neutral-400">
                        {a.contentType === "application/pdf" ? <FileText size={30} /> : a.contentType.startsWith("image/") ? <FileImage size={30} /> : <FileIcon size={30} />}
                      </div>
                    )}
                    <div className="px-2 py-1.5 flex items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs truncate text-neutral-800 dark:text-neutral-100" title={a.fileName}>
                          {a.fileName}
                        </div>
                        <div className="text-[10px] text-neutral-400 truncate">
                          {formatBytes(a.sizeBytes)} · {a.uploadedBy?.name ?? "—"}
                        </div>
                      </div>
                      <a href={a.downloadUrl} className="text-neutral-400 hover:text-indigo-600" aria-label={`${t("common.download")} ${a.fileName}`}>
                        <Download size={13} />
                      </a>
                      {canEdit && (
                        <button onClick={() => removeAttachment(a)} className="text-neutral-400 hover:text-red-600" aria-label={`${t("common.remove")} ${a.fileName}`}>
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Comments inline on narrow screens (the side panel is hidden there). */}
          <section className="mt-8 lg:hidden">
            <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 mb-2">{t("record.comments")}</h2>
            <div className="space-y-3">{rootComments.length ? rootComments.map((c) => commentView(c)) : <p className="text-xs text-neutral-400">{t("record.noComments")}</p>}</div>
            <CommentBox taskId={taskId} draft={draft} setDraft={setDraft} replyTo={replyTo} clearReply={() => setReplyTo(null)} onSend={postComment} testIdPrefix="record-comment-inline" />
          </section>
        </div>
      </div>

      <aside className="hidden lg:flex w-96 shrink-0 border-l border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex-col">
        <div className="flex items-center gap-1 px-3 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          {(
            [
              ["comments", `${t("record.comments")} (${comments.length})`, MessageSquare],
              ["activity", t("record.activity"), History],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setSide(key)}
              className={cn("flex items-center gap-1 px-2 py-2.5 -mb-px border-b-2 text-xs", side === key ? "border-indigo-600 text-indigo-700 dark:text-indigo-300 font-medium" : "border-transparent text-neutral-500")}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto thin-scroll p-3 space-y-3">
          {side === "comments" && (rootComments.length ? rootComments.map((c) => commentView(c)) : <p className="text-xs text-neutral-400">{t("record.noComments")}</p>)}
          {side === "activity" &&
            (activity.length ? (
              activity.map((a) => (
                <div key={a.id} className="text-xs border-l-2 border-neutral-200 dark:border-neutral-800 pl-2">
                  <div className="text-neutral-700 dark:text-neutral-300">
                    <span className="font-medium">{a.actor?.name ?? t("record.system")}</span> <span className="text-neutral-400">{formatDate(a.createdAt, true)}</span>
                  </div>
                  {a.summary && <div className="text-neutral-500">{a.summary}</div>}
                  {a.changes && (
                    <ul className="text-neutral-500 mt-0.5">
                      {Object.entries(a.changes).map(([k, v]) => (
                        <li key={k} className="truncate">
                          {k.replace(/^custom:/, "")}: <span className="line-through opacity-60">{JSON.stringify(v.from)}</span> → {JSON.stringify(v.to)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            ) : (
              <p className="text-xs text-neutral-400">{t("record.noActivity")}</p>
            ))}
        </div>
        {side === "comments" && (
          <div className="border-t border-neutral-200 dark:border-neutral-800 p-3 shrink-0">
            <CommentBox taskId={taskId} draft={draft} setDraft={setDraft} replyTo={replyTo} clearReply={() => setReplyTo(null)} onSend={postComment} />
          </div>
        )}
      </aside>
    </div>
  );
}

function CommentBox({ taskId, draft, setDraft, replyTo, clearReply, onSend, testIdPrefix = "record-comment" }: { taskId: string; draft: string; setDraft: (v: string) => void; replyTo: CommentItem | null; clearReply: () => void; onSend: () => void; testIdPrefix?: string }) {
  const { t } = useT();
  return (
    <div className="mt-2">
      {replyTo && (
        <div className="text-[11px] text-neutral-500 mb-1 flex items-center gap-1">
          <Reply size={11} /> {replyTo.user?.name}: <span className="truncate">{stripMentions(replyTo.body)}</span>
          <button onClick={clearReply} className="ml-auto text-neutral-400 hover:text-neutral-700" aria-label={t("common.cancel")}>
            ×
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <MentionInput taskId={taskId} value={draft} onChange={setDraft} onSubmit={onSend} placeholder={t("record.commentPlaceholder")} testId={`${testIdPrefix}-input`} />
        <Button size="icon" onClick={onSend} aria-label={t("record.send")} data-testid={`${testIdPrefix}-send`}>
          <Send size={13} />
        </Button>
      </div>
    </div>
  );
}

function TitleInput({ value, disabled, placeholder, onCommit }: { value: string; disabled: boolean; placeholder: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [last, setLast] = useState(value);
  if (value !== last) {
    setLast(value);
    setDraft(value);
  }
  return (
    <input
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() && draft !== value && onCommit(draft.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="w-full bg-transparent text-2xl md:text-3xl font-bold text-neutral-900 dark:text-neutral-50 outline-none placeholder:text-neutral-300"
      data-testid="record-title"
    />
  );
}
