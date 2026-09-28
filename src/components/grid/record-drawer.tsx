"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, Trash2, Send, Paperclip, Download, History, MessageSquare, ListChecks, Maximize2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Cell } from "./cell";
import type { Member, LinkTarget, OkrOptions } from "./cell";
import { getCellValue } from "@/lib/query-engine";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { AttachmentViewer } from "@/components/attachments/attachment-viewer";
import { MentionInput, CommentBody } from "@/components/comments/mention-input";
import { initials, formatDate, cn } from "@/lib/utils";
import type { ActivityRow, AttachmentRow, FieldRow, RecordRow } from "@/types";

interface CommentItem {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string; avatarColor: string } | null;
}

type Tab = "details" | "comments" | "files" | "activity";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function RecordDrawer({
  record,
  fields,
  members,
  linkTargets,
  okrOptions,
  canEdit = true,
  onClose,
  onChange,
  onDelete,
  pageHref,
}: {
  pageHref?: string;
  record: RecordRow;
  fields: FieldRow[];
  members: Member[];
  linkTargets: Record<string, LinkTarget>;
  okrOptions?: OkrOptions;
  canEdit?: boolean;
  onClose: () => void;
  onChange: (fieldId: string, value: unknown) => void;
  onDelete: () => void;
}) {
  const { t } = useT();
  const [tab, setTab] = useState<Tab>("details");
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [draft, setDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const primary = fields.find((f) => f.isPrimary);

  const loadSide = useCallback(() => {
    api.get<CommentItem[]>(`/api/tasks/${record.id}/comments`).then(setComments).catch(() => {});
    api.get<AttachmentRow[]>(`/api/tasks/${record.id}/attachments`).then(setAttachments).catch(() => {});
    api.get<ActivityRow[]>(`/api/tasks/${record.id}/activity`).then(setActivity).catch(() => {});
  }, [record.id]);

  useEffect(() => {
    loadSide();
  }, [loadSide, record.updatedAt]);

  async function postComment() {
    if (!draft.trim()) return;
    try {
      const c = await api.post<CommentItem>(`/api/tasks/${record.id}/comments`, { body: draft });
      setComments((prev) => [...prev, c]);
      setDraft("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/tasks/${record.id}/attachments`, { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Upload failed (${res.status})`);
      setAttachments((prev) => [body as AttachmentRow, ...prev]);
      toast.success(t("common.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeAttachment(a: AttachmentRow) {
    if (!confirm(`Remove "${a.fileName}"?`)) return;
    try {
      await api.delete(`/api/attachments/${a.id}`);
      setAttachments((prev) => prev.filter((x) => x.id !== a.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  const fieldName = (key: string) => fields.find((f) => f.id === `sys_${key.replace(/([A-Z])/g, "_$1").toLowerCase()}`)?.name ?? key.replace(/^custom:/, "");

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-lg h-full bg-white dark:bg-neutral-900 shadow-2xl flex flex-col animate-in" role="dialog" aria-label="Task details">
        <div className="flex items-center justify-between px-4 h-12 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <span className="font-medium text-neutral-900 dark:text-neutral-100 truncate">
            {primary ? (getCellValue(record, primary, fields) as string) || "Untitled task" : "Task"}
          </span>
          <div className="flex items-center gap-1">
            {pageHref && (
              <Link href={pageHref} className="p-1.5 rounded-md text-neutral-400 hover:text-indigo-600 hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t("record.openAsPage")} aria-label={t("record.openAsPage")} data-testid="drawer-open-page">
                <Maximize2 size={15} />
              </Link>
            )}
            {canEdit && (
              <button onClick={onDelete} className="p-1.5 rounded-md text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950" aria-label="Delete task">
                <Trash2 size={15} />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-md text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1 px-3 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          {(
            [
              ["details", t("record.properties"), ListChecks],
              ["comments", `${t("record.comments")} (${comments.length})`, MessageSquare],
              ["files", `${t("record.attachments")} (${attachments.length})`, Paperclip],
              ["activity", t("record.activity"), History],
            ] as const
          ).map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn("flex items-center gap-1 px-2 py-2 -mb-px border-b-2 text-xs", tab === key ? "border-indigo-600 text-indigo-700 dark:text-indigo-300 font-medium" : "border-transparent text-neutral-500")}
            >
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto thin-scroll p-4">
          {tab === "details" && (
            <div className="space-y-4">
              {fields.map((field) => (
                <div key={field.id}>
                  <label className="text-xs font-medium text-neutral-500 mb-1 block">{field.name}</label>
                  <div className="rounded-md border border-neutral-200 dark:border-neutral-800 min-h-[34px]">
                    <Cell
                      field={field}
                      value={getCellValue(record, field, fields)}
                      record={record}
                      members={members}
                      linkTargets={linkTargets}
                      okrOptions={okrOptions}
                      readOnlyOverride={!canEdit}
                      onChange={(v) => onChange(field.id, v)}
                    />
                  </div>
                </div>
              ))}
              <div className="text-xs text-neutral-400 pt-2 border-t border-neutral-100 dark:border-neutral-900">
                Created {formatDate(record.createdAt, true)} · Updated {formatDate(record.updatedAt, true)}
              </div>
            </div>
          )}

          {tab === "comments" && (
            <div className="space-y-3">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-2">
                  <span className="h-6 w-6 rounded-full flex items-center justify-center text-white text-[10px] shrink-0" style={{ backgroundColor: c.user?.avatarColor ?? "#94a3b8" }}>
                    {initials(c.user?.name ?? "?")}
                  </span>
                  <div className="text-sm min-w-0">
                    <div>
                      <span className="font-medium text-neutral-800 dark:text-neutral-100">{c.user?.name ?? "Deleted user"}</span>{" "}
                      <span className="text-[11px] text-neutral-400">{formatDate(c.createdAt, true)}</span>
                    </div>
                    <CommentBody body={c.body} className="text-neutral-600 dark:text-neutral-300" />
                  </div>
                </div>
              ))}
              {comments.length === 0 && <p className="text-xs text-neutral-400">{t("record.noComments")}</p>}
            </div>
          )}

          {tab === "files" && (
            <div className="space-y-2">
              {canEdit && (
                <div>
                  <input ref={fileRef} type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                  <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={uploading}>
                    <Paperclip size={13} /> {uploading ? t("common.loading") : t("record.attach")}
                  </Button>
                </div>
              )}
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-800 px-3 py-2">
                  <Paperclip size={13} className="text-neutral-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <button onClick={() => setViewing(attachments.indexOf(a))} className="block max-w-full truncate text-left text-neutral-800 dark:text-neutral-100 hover:text-indigo-600 hover:underline" title={t("att.view")} data-testid="drawer-attachment-open">
                      {a.fileName}
                    </button>
                    <div className="text-[11px] text-neutral-400">
                      {formatBytes(a.sizeBytes)} · {a.uploadedBy?.name ?? "Unknown"} · {formatDate(a.createdAt, true)}
                    </div>
                  </div>
                  <a href={a.downloadUrl} className="text-neutral-400 hover:text-indigo-600" aria-label={`Download ${a.fileName}`}>
                    <Download size={14} />
                  </a>
                  {canEdit && (
                    <button onClick={() => removeAttachment(a)} className="text-neutral-400 hover:text-red-600" aria-label={`Remove ${a.fileName}`}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
              {attachments.length === 0 && <p className="text-xs text-neutral-400">{t("record.noAttachments")}</p>}
            </div>
          )}

          {tab === "activity" && (
            <div className="space-y-2">
              {activity.map((a) => (
                <div key={a.id} className="text-xs border-l-2 border-neutral-200 dark:border-neutral-800 pl-2">
                  <div className="text-neutral-700 dark:text-neutral-300">
                    <span className="font-medium">{a.actor?.name ?? t("record.system")}</span> · {a.action.replace("_", " ")}{" "}
                    <span className="text-neutral-400">{formatDate(a.createdAt, true)}</span>
                  </div>
                  {a.summary && <div className="text-neutral-500">{a.summary}</div>}
                  {a.changes && (
                    <ul className="text-neutral-500 mt-0.5">
                      {Object.entries(a.changes).map(([k, v]) => (
                        <li key={k} className="truncate">
                          {fieldName(k)}: <span className="line-through opacity-60">{JSON.stringify(v.from)}</span> → {JSON.stringify(v.to)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {activity.length === 0 && <p className="text-xs text-neutral-400">{t("record.noActivity")}</p>}
            </div>
          )}
        </div>

        {tab === "comments" && (
          <div className="border-t border-neutral-200 dark:border-neutral-800 p-3 shrink-0 flex gap-2">
            <MentionInput taskId={record.id} rows={1} value={draft} onChange={setDraft} onSubmit={postComment} placeholder={t("record.commentPlaceholder")} testId="drawer-comment-input" />
            <Button size="icon" onClick={postComment} aria-label="Post comment">
              <Send size={13} />
            </Button>
          </div>
        )}
      </div>
      {viewing !== null && <AttachmentViewer files={attachments} index={viewing} onIndexChange={setViewing} onClose={() => setViewing(null)} />}
    </div>
  );
}
