"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Cell, type LinkTarget, type Member, type OkrOptions } from "@/components/grid/cell";
import { useT } from "@/components/i18n-provider";
import { getCellValue } from "@/lib/query-engine";
import { isGridFieldPasteable } from "@/lib/grid-clipboard";
import type { FieldRow, RecordRow } from "@/types";

/** Columns that need a saved task first (files, AI / API results, buttons) are left out of the form. */
const NEEDS_SAVED_TASK = new Set(["task_attachments", "attachment", "ai_field", "api_result", "button"]);

/** Fields the "New task" form offers: the table's visible, editable columns in the table's order. */
export function newTaskFormFields(visibleFields: FieldRow[]): FieldRow[] {
  return visibleFields.filter((f) => f.isPrimary || (isGridFieldPasteable(f) && !NEEDS_SAVED_TASK.has(f.type)));
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * "+ New task" form: one input per column the table shows (the same cells as typing into a new row),
 * then Add or Cancel. Nothing is saved until Add; the task is created through the normal task API.
 */
export function NewTaskDialog({
  open,
  onOpenChange,
  fields,
  allFields,
  members,
  linkTargets,
  okrOptions,
  initialData,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The table's visible columns, in order. */
  fields: FieldRow[];
  allFields: FieldRow[];
  members: Member[];
  linkTargets: Record<string, LinkTarget>;
  okrOptions?: OkrOptions;
  /** Pre-filled values (e.g. the group the table is grouped by). */
  initialData: Record<string, unknown>;
  /** Creates the task; resolves true when it was saved. */
  onSubmit: (data: Record<string, unknown>) => Promise<boolean>;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState<Record<string, unknown>>(initialData);
  const [saving, setSaving] = useState(false);
  const formFields = newTaskFormFields(fields);
  const primary = allFields.find((f) => f.isPrimary);
  const title = String(draft[primary?.id ?? "sys_title"] ?? "");
  const now = new Date().toISOString();
  const record: RecordRow = { id: "new-task", projectId: fields[0]?.projectId ?? "", data: draft, order: 0, createdById: null, createdAt: now, updatedAt: now };

  async function submit() {
    if (!title.trim() || saving) return;
    setSaving(true);
    const data = Object.fromEntries(Object.entries(draft).filter(([, v]) => !isEmpty(v)));
    const ok = await onSubmit(data).finally(() => setSaving(false));
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="max-w-xl max-h-[85vh] flex flex-col" data-testid="new-task-dialog">
        <DialogTitle>{t("ntd.title")}</DialogTitle>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="-mx-1 flex-1 space-y-3 overflow-y-auto px-1 thin-scroll">
            {formFields.map((field) => (
              <div key={field.id}>
                <label className="mb-1 block text-xs font-medium text-neutral-500" htmlFor={field.isPrimary ? "ntd-title" : undefined}>
                  {field.name}
                  {field.isPrimary ? <span className="text-red-500"> *</span> : null}
                </label>
                {field.isPrimary ? (
                  <input
                    id="ntd-title"
                    autoFocus
                    value={title}
                    maxLength={500}
                    onChange={(e) => setDraft((d) => ({ ...d, [field.id]: e.target.value }))}
                    placeholder={t("record.titlePlaceholder")}
                    className="h-9 w-full rounded-md border border-neutral-200 bg-white px-2 text-sm outline-none focus:border-indigo-400 dark:border-neutral-800 dark:bg-neutral-900"
                    data-testid="ntd-title"
                  />
                ) : (
                  <div className="min-h-[36px] rounded-md border border-neutral-200 dark:border-neutral-800" data-testid={`ntd-field-${field.id}`}>
                    <Cell
                      field={field}
                      value={getCellValue(record, field, allFields)}
                      record={record}
                      members={members}
                      linkTargets={linkTargets}
                      okrOptions={okrOptions}
                      wrapText={field.type === "long_text"}
                      onChange={(v) => setDraft((d) => ({ ...d, [field.id]: v }))}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-800">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving} data-testid="ntd-cancel">
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!title.trim() || saving} data-testid="ntd-add">
              <Plus size={13} /> {saving ? t("common.saving") : t("ntd.add")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
