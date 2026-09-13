"use client";
import { useEffect, useState } from "react";
import { X, Trash2, Send } from "lucide-react";
import { Cell } from "./cell";
import type { Member, LinkTarget, OkrOptions } from "./cell";
import { getCellValue } from "@/lib/query-engine";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { initials, formatDate } from "@/lib/utils";
import { getFieldType } from "@/lib/field-types";
import type { FieldRow, RecordRow } from "@/types";

interface CommentItem {
  id: string;
  body: string;
  createdAt: string;
  user: { id: string; name: string; avatarColor: string };
}

export function RecordDrawer({
  record,
  fields,
  members,
  linkTargets,
  okrOptions,
  onClose,
  onChange,
  onDelete,
}: {
  record: RecordRow;
  fields: FieldRow[];
  members: Member[];
  linkTargets: Record<string, LinkTarget>;
  okrOptions?: OkrOptions;
  onClose: () => void;
  onChange: (fieldId: string, value: unknown) => void;
  onDelete: () => void;
}) {
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [draft, setDraft] = useState("");
  const primary = fields.find((f) => f.isPrimary);

  useEffect(() => {
    api.get<CommentItem[]>(`/api/records/${record.id}/comments`).then(setComments).catch(() => {});
  }, [record.id]);

  async function postComment() {
    if (!draft.trim()) return;
    try {
      const c = await api.post<CommentItem>(`/api/records/${record.id}/comments`, { body: draft });
      setComments((prev) => [...prev, c]);
      setDraft("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to post comment");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-lg h-full bg-white dark:bg-neutral-900 shadow-2xl flex flex-col animate-in">
        <div className="flex items-center justify-between px-4 h-12 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <span className="font-medium text-neutral-900 dark:text-neutral-100 truncate">
            {primary ? getCellValue(record, primary, fields) as string || "Untitled record" : "Record"}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={onDelete} className="p-1.5 rounded-md text-neutral-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950">
              <Trash2 size={15} />
            </button>
            <button onClick={onClose} className="p-1.5 rounded-md text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto thin-scroll p-4 space-y-4">
          {fields.map((field) => {
            const typeDef = getFieldType(field.type);
            const value = getCellValue(record, field, fields);
            return (
              <div key={field.id}>
                <label className="text-xs font-medium text-neutral-500 mb-1 block">{field.name}</label>
                <div className="rounded-md border border-neutral-200 dark:border-neutral-800 min-h-[34px]">
                  <Cell field={field} value={value} record={record} members={members} linkTargets={linkTargets} okrOptions={okrOptions} onChange={(v) => onChange(field.id, v)} />
                </div>
                {typeDef.comingSoon && <p className="text-[11px] text-neutral-400 mt-1">Coming soon in a later phase</p>}
              </div>
            );
          })}
          <div className="text-xs text-neutral-400 pt-2 border-t border-neutral-100 dark:border-neutral-900">
            Created {formatDate(record.createdAt, true)} · Updated {formatDate(record.updatedAt, true)}
          </div>
        </div>

        <div className="border-t border-neutral-200 dark:border-neutral-800 p-3 shrink-0">
          <div className="max-h-40 overflow-y-auto thin-scroll space-y-2 mb-2">
            {comments.map((c) => (
              <div key={c.id} className="flex gap-2">
                <span className="h-6 w-6 rounded-full flex items-center justify-center text-white text-[10px] shrink-0" style={{ backgroundColor: c.user.avatarColor }}>
                  {initials(c.user.name)}
                </span>
                <div className="text-sm">
                  <span className="font-medium text-neutral-800 dark:text-neutral-100">{c.user.name}</span>{" "}
                  <span className="text-neutral-500">{c.body}</span>
                </div>
              </div>
            ))}
            {comments.length === 0 && <p className="text-xs text-neutral-400">No comments yet</p>}
          </div>
          <div className="flex gap-2">
            <Textarea rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a comment…" className="flex-1" />
            <Button size="icon" onClick={postComment}>
              <Send size={13} />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
