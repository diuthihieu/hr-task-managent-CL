"use client";
import { useState } from "react";
import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Cell, type LinkTarget, type Member } from "@/components/grid/cell";
import { useT } from "@/components/i18n-provider";
import { getCellValue } from "@/lib/query-engine";
import type { FieldRow, RecordRow } from "@/types";

/**
 * Quick look at a task (e.g. a sub-task clicked in its parent): every field, editable in place like the
 * side panel, plus "Open full task". Each change is saved at once through `onChange` (the normal task API).
 */
export function QuickTaskDialog({
  record,
  fields,
  members,
  linkTargets,
  canEdit,
  onChange,
  onOpenFull,
  onClose,
}: {
  record: RecordRow;
  fields: FieldRow[];
  members: Member[];
  linkTargets: Record<string, LinkTarget>;
  canEdit: boolean;
  onChange: (patch: Record<string, unknown>) => void;
  onOpenFull: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const primary = fields.find((f) => f.isPrimary);
  const savedTitle = String(record.data[primary?.id ?? "sys_title"] ?? "");
  const [title, setTitle] = useState(savedTitle);
  const [lastSaved, setLastSaved] = useState(savedTitle);
  if (savedTitle !== lastSaved) {
    setLastSaved(savedTitle);
    setTitle(savedTitle);
  }
  const commitTitle = () => {
    const next = title.trim();
    if (next && next !== savedTitle && primary) onChange({ [primary.id]: next });
    else setTitle(savedTitle);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col" data-testid="quick-task-dialog">
        <DialogTitle className="sr-only">{savedTitle || t("task.untitled")}</DialogTitle>
        <div className="flex items-start gap-2 pr-6">
          <textarea
            rows={1}
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, " "))}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                (e.target as HTMLTextAreaElement).blur();
              }
            }}
            className="field-sizing-content min-h-9 flex-1 resize-none bg-transparent text-lg font-semibold leading-snug text-neutral-900 outline-none dark:text-neutral-50"
            aria-label={primary?.name ?? t("record.titlePlaceholder")}
            data-testid="qt-title"
          />
          <Button variant="secondary" onClick={onOpenFull} data-testid="qt-open-full">
            <Maximize2 size={13} /> {t("qt.openFull")}
          </Button>
        </div>
        <div className="mt-3 -mx-1 flex-1 overflow-y-auto px-1 thin-scroll">
          <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[150px_1fr]">
            {fields
              .filter((f) => !f.isPrimary)
              .map((field) => (
                <div key={field.id} className="contents">
                  <div className="truncate pt-2 text-xs text-neutral-500" title={field.name}>
                    {field.name}
                  </div>
                  <div className="min-h-[34px] rounded-md border border-neutral-200 dark:border-neutral-800" data-testid={`qt-field-${field.id}`}>
                    <Cell
                      field={field}
                      value={getCellValue(record, field, fields)}
                      record={record}
                      members={members}
                      linkTargets={linkTargets}
                      readOnlyOverride={!canEdit || field.readOnly}
                      wrapText={field.type === "long_text"}
                      onChange={(v) => onChange({ [field.id]: v })}
                    />
                  </div>
                </div>
              ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
