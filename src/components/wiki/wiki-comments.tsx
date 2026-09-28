"use client";
import { useEffect, useRef, useState } from "react";
import { MessageSquare, Paperclip, Send, Trash2, X, CornerDownRight, Loader2, FileText } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { MentionInput, CommentBody } from "@/components/comments/mention-input";
import { AttachmentViewer } from "@/components/attachments/attachment-viewer";
import { formatDate, initials, cn } from "@/lib/utils";

interface FileRow {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
}
interface WikiCommentRow {
  id: string;
  body: string;
  parentCommentId: string | null;
  createdAt: string;
  author: { id: string; name: string; avatarColor: string } | null;
  attachments: FileRow[];
}

const MAX_FILE = 4 * 1024 * 1024;

/**
 * Discussion under a wiki page: Markdown formatting, @mentions (people who can
 * open the wiki get notified), replies and file attachments. The wiki's AI
 * reads comments and the text of attached files.
 */
export function WikiComments({ pageId, currentUserId, canManage }: { pageId: string; currentUserId: string | null; canManage: boolean }) {
  const { t } = useT();
  const [items, setItems] = useState<WikiCommentRow[]>([]);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<WikiCommentRow | null>(null);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [viewer, setViewer] = useState<{ files: FileRow[]; index: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    api.get<WikiCommentRow[]>(`/api/wiki/${pageId}/comments`).then((r) => alive && setItems(r)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [pageId]);

  async function upload(list: FileList) {
    setUploading(true);
    for (const file of Array.from(list).slice(0, 10 - files.length)) {
      if (file.size > MAX_FILE) {
        toast.error(t("att.tooLarge", { name: file.name }));
        continue;
      }
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("purpose", "comment");
        const res = await fetch(`/api/wiki/${pageId}/attachments`, { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || t("att.failed"));
        setFiles((prev) => [...prev, { id: body.id, fileName: body.fileName, contentType: body.contentType, sizeBytes: body.sizeBytes }]);
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : t("att.failed")}`);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function send() {
    if (!draft.trim() || sending) return;
    setSending(true);
    try {
      const c = await api.post<WikiCommentRow>(`/api/wiki/${pageId}/comments`, { body: draft, parentCommentId: replyTo?.id ?? null, attachmentIds: files.map((f) => f.id) });
      setItems((prev) => [...prev, c]);
      setDraft("");
      setFiles([]);
      setReplyTo(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSending(false);
    }
  }

  async function remove(c: WikiCommentRow) {
    if (!confirm(t("wc.deleteConfirm"))) return;
    try {
      await api.delete(`/api/wiki-comments/${c.id}`);
      setItems((prev) => prev.filter((x) => x.id !== c.id && x.parentCommentId !== c.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  const roots = items.filter((c) => !c.parentCommentId || !items.some((x) => x.id === c.parentCommentId));
  const repliesOf = (id: string) => items.filter((c) => c.parentCommentId === id);

  const view = (c: WikiCommentRow, nested = false) => (
    <div key={c.id} className={cn("flex gap-2.5 group", nested && "mt-3")} data-testid="wiki-comment">
      <span className="h-7 w-7 rounded-full text-white text-[10px] font-semibold flex items-center justify-center shrink-0" style={{ backgroundColor: c.author?.avatarColor ?? "#94a3b8" }}>
        {initials(c.author?.name ?? "?")}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-semibold text-neutral-800 dark:text-neutral-100">{c.author?.name ?? t("record.deletedUser")}</span>
          <span className="text-neutral-400">{formatDate(c.createdAt, true)}</span>
          <span className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100">
            {!nested && (
              <button onClick={() => setReplyTo(c)} className="text-neutral-400 hover:text-indigo-600" title={t("wc.reply")}>
                <CornerDownRight size={12} />
              </button>
            )}
            {(c.author?.id === currentUserId || canManage) && (
              <button onClick={() => remove(c)} className="text-neutral-400 hover:text-red-600" title={t("common.delete")}>
                <Trash2 size={12} />
              </button>
            )}
          </span>
        </div>
        <CommentBody body={c.body} markdown className="text-sm text-neutral-700 dark:text-neutral-300" />
        {c.attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {c.attachments.map((a, i) => (
              <button key={a.id} onClick={() => setViewer({ files: c.attachments, index: i })} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300 hover:border-indigo-300 max-w-60" data-testid="wiki-comment-file">
                {a.contentType.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authorized attachment route
                  <img src={`/api/attachments/${a.id}/download?inline=1`} alt="" className="h-5 w-5 rounded object-cover" />
                ) : (
                  <FileText size={12} className="shrink-0" />
                )}
                <span className="truncate">{a.fileName}</span>
              </button>
            ))}
          </div>
        )}
        {!nested && repliesOf(c.id).map((r) => view(r, true))}
      </div>
    </div>
  );

  return (
    <section id="comments" className="mt-10 border-t border-neutral-200 dark:border-neutral-800 pt-6" data-testid="wiki-comments">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-100 mb-4">
        <MessageSquare size={15} /> {t("wc.title")} <span className="text-neutral-400 font-normal">{items.length}</span>
      </h2>
      <div className="space-y-5 mb-5">
        {roots.length === 0 && <p className="text-xs text-neutral-400">{t("wc.empty")}</p>}
        {roots.map((c) => view(c))}
      </div>

      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
        {replyTo && (
          <div className="flex items-center gap-2 text-xs text-neutral-500 mb-2">
            <CornerDownRight size={12} /> {t("wc.replyingTo", { name: replyTo.author?.name ?? "" })}
            <button onClick={() => setReplyTo(null)} className="ml-auto text-neutral-400 hover:text-neutral-700" aria-label={t("common.cancel")}>
              <X size={12} />
            </button>
          </div>
        )}
        <MentionInput mentionUrl={`/api/wiki/${pageId}/mentionable`} formatting rows={3} value={draft} onChange={setDraft} onSubmit={send} placeholder={t("wc.placeholder")} testId="wiki-comment-input" />
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {files.map((f) => (
              <span key={f.id} className="inline-flex items-center gap-1 rounded-md bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300 max-w-56">
                <Paperclip size={11} /> <span className="truncate">{f.fileName}</span>
                <button onClick={() => setFiles((prev) => prev.filter((x) => x.id !== f.id))} className="text-neutral-400 hover:text-red-600" aria-label={t("common.remove")}>
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 mt-2">
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} data-testid="wiki-comment-file-input" />
          <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading || files.length >= 10}>
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Paperclip size={13} />} {t("wc.attach")}
          </Button>
          <span className="text-[11px] text-neutral-400 hidden sm:inline">{t("wc.hint")}</span>
          <Button size="sm" className="ml-auto" onClick={send} disabled={!draft.trim() || sending || uploading} data-testid="wiki-comment-send">
            {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {t("wc.send")}
          </Button>
        </div>
      </div>
      {viewer && <AttachmentViewer files={viewer.files} index={viewer.index} onIndexChange={(i) => setViewer((v) => (v ? { ...v, index: i } : v))} onClose={() => setViewer(null)} />}
    </section>
  );
}
