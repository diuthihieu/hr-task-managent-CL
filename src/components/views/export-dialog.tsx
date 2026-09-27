"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { buildExportMatrix, downloadCsv, downloadXlsx } from "@/lib/export";
import { toast } from "@/components/ui/toast";
import type { FieldRow, RecordRow } from "@/types";
import type { FormatMember } from "@/lib/format";
import { useT } from "@/components/i18n-provider";

export function ExportDialog({
  open,
  onOpenChange,
  tableName,
  allFields,
  visibleFields,
  allRecords,
  filteredRecords,
  selectedRecords,
  members,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tableName: string;
  allFields: FieldRow[];
  visibleFields: FieldRow[];
  allRecords: RecordRow[];
  filteredRecords: RecordRow[];
  selectedRecords: RecordRow[];
  members: FormatMember[];
}) {
  const { t } = useT();
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [scope, setScope] = useState<"filtered" | "all" | "selected">("filtered");
  const [fieldScope, setFieldScope] = useState<"visible" | "all">("visible");

  const scopeRecords = { filtered: filteredRecords, all: allRecords, selected: selectedRecords };
  const recordCount = scopeRecords[scope].length;

  async function handleExport() {
    const records = scopeRecords[scope];
    const fields = fieldScope === "visible" ? visibleFields : allFields;
    if (!records.length) {
      toast.error(t("ex.none"));
      return;
    }
    const matrix = buildExportMatrix(fields, records, members);
    const filename = `${tableName.replace(/[^a-z0-9]+/gi, "-")}-${new Date().toISOString().slice(0, 10)}`;
    try {
      if (format === "csv") downloadCsv(matrix, filename);
      else await downloadXlsx(matrix, filename);
      toast.success(t("ex.done", { count: records.length }));
      onOpenChange(false);
    } catch {
      toast.error(t("ex.failed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t("ex.title", { name: tableName })}</DialogTitle>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">{t("ex.format")}</label>
            <div className="flex gap-2">
              {(["csv", "xlsx"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium uppercase ${
                    format === f
                      ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                      : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">{t("ex.records")}</label>
            <div className="space-y-1">
              <RadioRow label={t("ex.filtered", { count: filteredRecords.length })} checked={scope === "filtered"} onSelect={() => setScope("filtered")} />
              <RadioRow label={t("ex.all", { count: allRecords.length })} checked={scope === "all"} onSelect={() => setScope("all")} />
              <RadioRow
                label={t("ex.selected", { count: selectedRecords.length })}
                checked={scope === "selected"}
                onSelect={() => setScope("selected")}
                disabled={selectedRecords.length === 0}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1.5 block">{t("tb.fields")}</label>
            <div className="space-y-1">
              <RadioRow label={t("ex.visibleFields", { count: visibleFields.length })} checked={fieldScope === "visible"} onSelect={() => setFieldScope("visible")} />
              <RadioRow label={t("ex.allFields", { count: allFields.length })} checked={fieldScope === "all"} onSelect={() => setFieldScope("all")} />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleExport} disabled={!recordCount}>
            {t("ex.submit", { count: recordCount })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RadioRow({ label, checked, onSelect, disabled }: { label: string; checked: boolean; onSelect: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300" : "hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300"
      }`}
    >
      <span className={`h-3.5 w-3.5 rounded-full border-2 shrink-0 ${checked ? "border-indigo-600 bg-indigo-600" : "border-neutral-300 dark:border-neutral-600"}`} />
      {label}
    </button>
  );
}
