"use client";
import { useCallback, useRef, useState } from "react";
import { Paperclip, X, FileText, FileImage } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

// Attachments for the AI chats: pick, paste or drop up to 5 files (4 MB in
// total). The server re-checks everything (type by content, size, count).

export const MAX_FILES = 5;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const ACCEPT = "image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf,.docx,.xlsx,.pptx,.txt,.md,.markdown,.csv,.tsv,.json,.html,.htm,.log";
const DOC = /\.(pdf|docx|xlsx|pptx|txt|md|markdown|csv|tsv|json|html?|log)$/i;
const IMAGE = /^image\/(png|jpeg|webp|gif)$/;

export type FileKind = "image" | "pdf" | "document";
/** A file shown on a chat message; `preview` is an in-session image URL, `text` a document's extracted text. */
export interface MessageFile {
  name: string;
  kind: FileKind;
  size: number;
  preview?: string;
  text?: string;
}

export const fileKind = (f: File): FileKind => (IMAGE.test(f.type) ? "image" : /\.pdf$/i.test(f.name) || f.type === "application/pdf" ? "pdf" : "document");
const supported = (f: File) => IMAGE.test(f.type) || DOC.test(f.name);

/** What a message shows for files just sent from this browser. */
export const toMessageFiles = (files: File[]): MessageFile[] =>
  files.map((f) => ({ name: f.name, kind: fileKind(f), size: f.size, preview: fileKind(f) === "image" ? URL.createObjectURL(f) : undefined }));

/** POST an AI chat turn: JSON, or multipart with the JSON in "payload" when files are attached. */
export function postChat(url: string, payload: unknown, files: File[], signal?: AbortSignal) {
  if (!files.length) return fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal });
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  for (const f of files) form.append("files", f, f.name);
  return fetch(url, { method: "POST", body: form, signal });
}

/** Files waiting in the composer. */
export function useChatFiles() {
  const { t } = useT();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(
    (list: FileList | File[] | null | undefined) => {
      const incoming = Array.from(list ?? []);
      if (!incoming.length) return;
      const bad = incoming.find((f) => !supported(f));
      if (bad) return setError(t("ai.attach.unsupported", { name: bad.name }));
      const next = [...files, ...incoming];
      if (next.length > MAX_FILES) return setError(t("ai.attach.tooMany"));
      if (next.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return setError(t("ai.attach.tooBig"));
      setError(null);
      setFiles(next);
    },
    [files, t]
  );
  const remove = useCallback((i: number) => {
    setError(null);
    setFiles((prev) => prev.filter((_, j) => j !== i));
  }, []);
  const clear = useCallback(() => {
    setError(null);
    setFiles([]);
  }, []);
  return { files, error, add, remove, clear };
}
export type ChatFiles = ReturnType<typeof useChatFiles>;

export function AttachButton({ onPick, disabled }: { onPick: (files: FileList | null) => void; disabled?: boolean }) {
  const { t } = useT();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" onClick={() => ref.current?.click()} disabled={disabled} className="h-8 w-8 rounded-full text-neutral-500 hover:text-indigo-600 hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-center shrink-0 disabled:opacity-40" title={t("ai.attach")} aria-label={t("ai.attach")} data-testid="ai-attach">
        <Paperclip size={16} />
      </button>
      <input
        ref={ref}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files);
          e.target.value = "";
        }}
        data-testid="ai-attach-input"
      />
    </>
  );
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Chips for the files waiting in the composer. */
export function PendingFiles({ chat }: { chat: ChatFiles }) {
  const { t } = useT();
  if (!chat.files.length && !chat.error) return null;
  return (
    <div className="mb-1.5 space-y-1">
      {chat.files.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="ai-pending-files">
          {chat.files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1.5 max-w-[14rem] rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 pl-2 pr-1 py-1 text-xs text-neutral-700 dark:text-neutral-200">
              {fileKind(f) === "image" ? <FileImage size={13} className="shrink-0 text-indigo-500" /> : <FileText size={13} className="shrink-0 text-indigo-500" />}
              <span className="truncate">{f.name}</span>
              <span className="text-neutral-400 shrink-0">{kb(f.size)}</span>
              <button type="button" onClick={() => chat.remove(i)} className="p-0.5 rounded text-neutral-400 hover:text-red-600" aria-label={t("ai.attach.remove")} title={t("ai.attach.remove")}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {chat.error && (
        <div className="text-xs text-red-600" data-testid="ai-attach-error">
          {chat.error}
        </div>
      )}
    </div>
  );
}

/** Files on a sent user message (inside the indigo bubble). */
export function MessageFiles({ files }: { files?: MessageFile[] }) {
  if (!files?.length) return null;
  return (
    <div className="flex flex-wrap justify-end gap-1.5 mb-1" data-testid="ai-message-files">
      {files.map((f, i) =>
        f.preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL, not an optimizable asset
          <img key={i} src={f.preview} alt={f.name} title={f.name} className="h-20 max-w-[10rem] rounded-lg object-cover border border-neutral-200 dark:border-neutral-700" />
        ) : (
          <span key={i} className="inline-flex items-center gap-1.5 max-w-[14rem] rounded-lg bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-200 px-2 py-1 text-xs" title={f.name}>
            {f.kind === "image" ? <FileImage size={13} className="shrink-0" /> : <FileText size={13} className="shrink-0" />}
            <span className="truncate">{f.name}</span>
          </span>
        )
      )}
    </div>
  );
}

/** Drag & drop + paste onto a composer: returns props for the wrapper and the textarea. */
export function useFileDrop(chat: ChatFiles, enabled = true) {
  const [over, setOver] = useState(false);
  const has = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  return {
    over,
    zone: {
      onDragOver: (e: React.DragEvent) => {
        if (!enabled || !has(e)) return;
        e.preventDefault();
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: React.DragEvent) => {
        setOver(false);
        if (!enabled || !e.dataTransfer.files.length) return;
        e.preventDefault();
        chat.add(e.dataTransfer.files);
      },
    },
    onPaste: (e: React.ClipboardEvent) => {
      if (!enabled || !e.clipboardData.files.length) return;
      e.preventDefault();
      chat.add(e.clipboardData.files);
    },
  };
}

export const dropRing = (over: boolean) => cn(over && "ring-2 ring-indigo-300 border-indigo-400");
