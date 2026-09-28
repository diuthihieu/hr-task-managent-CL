"use client";
import { useRef, useState } from "react";
import { Paperclip, Upload, Trash2, Download, Loader2 } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";

export interface CellFile {
  id: string;
  name: string;
  type: string;
}

const MAX_BYTES = 4 * 1024 * 1024;

/** Grid cell for a task's attachments: thumbnails in the cell, a popover to upload (multiple), download and remove. */
export function AttachmentsCell({ taskId, files, className, onChange }: { taskId: string; files: CellFile[]; className?: string; onChange: (files: CellFile[]) => void }) {
  const { t } = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  async function upload(list: FileList | File[]) {
    const items = Array.from(list);
    if (!items.length) return;
    setBusy(true);
    let next = files;
    for (const file of items) {
      if (file.size > MAX_BYTES) {
        toast.error(t("att.tooLarge", { name: file.name }));
        continue;
      }
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: "POST", body: form });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || t("att.failed"));
        next = [...next, { id: body.id, name: body.fileName, type: body.contentType }];
        onChange(next);
      } catch (e) {
        toast.error(`${file.name}: ${e instanceof Error ? e.message : t("att.failed")}`);
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function remove(f: CellFile) {
    if (!confirm(t("att.removeConfirm", { name: f.name }))) return;
    try {
      await api.delete(`/api/attachments/${f.id}`);
      onChange(files.filter((x) => x.id !== f.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className={cn(className, "gap-1 overflow-hidden cursor-pointer")} title={files.map((f) => f.name).join("\n") || t("att.add")} data-testid="cell-attachments">
          {files.length ? (
            <>
              {files.filter((f) => f.type.startsWith("image/")).slice(0, 3).map((f) => (
                // eslint-disable-next-line @next/next/no-img-element -- authorized download route, not a static asset
                <img key={f.id} src={`/api/attachments/${f.id}/download?inline=1`} alt={f.name} className="h-6 w-6 rounded object-cover border border-neutral-200 dark:border-neutral-700" />
              ))}
              <span className="inline-flex items-center gap-1 text-xs text-neutral-500">
                <Paperclip size={11} /> {files.length}
              </span>
            </>
          ) : (
            <span className="text-neutral-300 group-hover/row:text-neutral-400 inline-flex items-center gap-1 text-xs">
              <Paperclip size={11} />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            upload(e.dataTransfer.files);
          }}
          onClick={() => !busy && fileRef.current?.click()}
          className={cn(
            "flex flex-col items-center justify-center gap-1 rounded-md border border-dashed px-3 py-4 text-xs cursor-pointer transition-colors",
            dragOver ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40" : "border-neutral-300 dark:border-neutral-700 hover:border-indigo-400"
          )}
        >
          {busy ? <Loader2 size={16} className="animate-spin text-indigo-600" /> : <Upload size={16} className="text-neutral-400" />}
          <span className="text-neutral-600 dark:text-neutral-300">{busy ? t("att.uploading") : t("att.drop")}</span>
          <span className="text-[10px] text-neutral-400">{t("att.limit")}</span>
        </div>
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} data-testid="cell-attachments-input" />
        {files.length > 0 && (
          <ul className="mt-2 max-h-56 overflow-y-auto thin-scroll divide-y divide-neutral-100 dark:divide-neutral-800">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 py-1.5 text-xs">
                {f.type.startsWith("image/") ? (
                  // eslint-disable-next-line @next/next/no-img-element -- authorized download route
                  <img src={`/api/attachments/${f.id}/download?inline=1`} alt="" className="h-7 w-7 rounded object-cover border border-neutral-200 dark:border-neutral-700 shrink-0" />
                ) : (
                  <span className="h-7 w-7 rounded bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
                    <Paperclip size={12} className="text-neutral-400" />
                  </span>
                )}
                <span className="flex-1 truncate text-neutral-700 dark:text-neutral-200" title={f.name}>
                  {f.name}
                </span>
                <a href={`/api/attachments/${f.id}/download`} className="text-neutral-400 hover:text-indigo-600" title={t("att.download")}>
                  <Download size={13} />
                </a>
                <button onClick={() => remove(f)} className="text-neutral-400 hover:text-red-600" title={t("common.delete")}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
