"use client";
import { Settings2 } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select } from "@/components/ui/misc";
import type { GanttConfig } from "@/lib/query-engine";
import type { FieldRow } from "@/types";
import { useT } from "@/components/i18n-provider";

const DATE_TYPES = ["date", "datetime"];
const PROGRESS_TYPES = ["progress", "number", "percent", "integer"];
const OWNER_TYPES = ["person", "people"];
const STATUS_TYPES = ["status", "single_select"];

export function GanttSettings({
  fields,
  config,
  onChange,
}: {
  fields: FieldRow[];
  config: GanttConfig;
  onChange: (patch: Partial<GanttConfig>) => void;
}) {
  const { t } = useT();
  const dateFields = fields.filter((f) => DATE_TYPES.includes(f.type));
  const progressFields = fields.filter((f) => PROGRESS_TYPES.includes(f.type));
  const ownerFields = fields.filter((f) => OWNER_TYPES.includes(f.type));
  const statusFields = fields.filter((f) => STATUS_TYPES.includes(f.type));
  const linkFields = fields.filter((f) => f.type === "link");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 h-7 px-2 rounded-md text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 shrink-0">
          <Settings2 size={13} /> {t("gt.settings")}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-2.5">
        <div className="text-xs font-semibold text-neutral-500 mb-1">{t("gt.map")}</div>
        <Field label={t("gt.task")}>
          <Select value={config.taskFieldId ?? ""} onValueChange={(v) => onChange({ taskFieldId: v })} options={fields.map((f) => ({ value: f.id, label: f.name }))} className="w-full" />
        </Field>
        <Field label={t("gt.taskColumnSizing")}>
          <Select
            value={config.taskColumnSizing ?? "fixed"}
            onValueChange={(value) => onChange({ taskColumnSizing: value as "fixed" | "fit" })}
            options={[
              { value: "fixed", label: t("gt.taskColumnFixed") },
              { value: "fit", label: t("gt.taskColumnFit") },
            ]}
            className="w-full"
          />
          <p className="mt-1 text-[11px] text-neutral-400">{t("gt.taskColumnSizingHint")}</p>
        </Field>
        <Field label={t("gt.start")}>
          <Select value={config.startFieldId ?? ""} onValueChange={(v) => onChange({ startFieldId: v })} options={dateFields.map((f) => ({ value: f.id, label: f.name }))} className="w-full" placeholder={t("common.none")} />
        </Field>
        <Field label={t("gt.end")}>
          <Select value={config.endFieldId ?? ""} onValueChange={(v) => onChange({ endFieldId: v })} options={dateFields.map((f) => ({ value: f.id, label: f.name }))} className="w-full" placeholder={t("common.none")} />
        </Field>
        <Field label={t("gt.progress")}>
          <Select value={config.progressFieldId ?? ""} onValueChange={(v) => onChange({ progressFieldId: v })} options={progressFields.map((f) => ({ value: f.id, label: f.name }))} className="w-full" placeholder={t("common.none")} />
        </Field>
        <Field label={t("gt.owner")}>
          <Select value={config.ownerFieldId ?? ""} onValueChange={(v) => onChange({ ownerFieldId: v })} options={ownerFields.map((f) => ({ value: f.id, label: f.name }))} className="w-full" placeholder={t("common.none")} />
        </Field>
        <Field label={t("gt.status")}>
          <Select value={config.statusFieldId ?? ""} onValueChange={(v) => onChange({ statusFieldId: v })} options={statusFields.map((f) => ({ value: f.id, label: f.name }))} className="w-full" placeholder={t("common.none")} />
        </Field>
        <Field label={t("gt.deps")}>
          <Select value={config.dependencyFieldId ?? ""} onValueChange={(v) => onChange({ dependencyFieldId: v })} options={linkFields.map((f) => ({ value: f.id, label: f.name }))} className="w-full" placeholder={t("common.none")} />
        </Field>
        {linkFields.length === 0 && (
          <p className="text-[11px] text-neutral-400">{t("gt.depsHint")}</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] font-medium text-neutral-500 mb-0.5 block">{label}</label>
      {children}
    </div>
  );
}
