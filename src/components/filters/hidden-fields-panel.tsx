"use client";
import { Eye, EyeOff } from "lucide-react";
import { Switch } from "@/components/ui/misc";
import type { FieldRow } from "@/types";
import { useT } from "@/components/i18n-provider";

export function HiddenFieldsPanel({
  fields,
  hiddenFieldIds,
  onChange,
}: {
  fields: FieldRow[];
  hiddenFieldIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useT();
  const visibleCount = fields.length - hiddenFieldIds.length;
  return (
    <div className="w-64 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-500">
          <Eye size={13} /> {t("hid.title", { visible: visibleCount, total: fields.length })}
        </div>
        <div className="flex gap-2 text-xs">
          <button onClick={() => onChange([])} className="text-indigo-600 hover:underline">
            {t("hid.showAll")}
          </button>
          <button onClick={() => onChange(fields.filter((f) => !f.isPrimary).map((f) => f.id))} className="text-indigo-600 hover:underline">
            {t("hid.hideAll")}
          </button>
        </div>
      </div>
      <div className="space-y-1 max-h-72 overflow-y-auto thin-scroll">
        {fields.map((f) => {
          const hidden = hiddenFieldIds.includes(f.id);
          return (
            <div key={f.id} className="flex items-center justify-between px-1 py-1">
              <span className="flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-200 truncate">
                {hidden ? <EyeOff size={13} className="text-neutral-400" /> : <Eye size={13} className="text-neutral-400" />}
                {f.name}
              </span>
              <Switch
                checked={!hidden}
                onCheckedChange={(v) => onChange(v ? hiddenFieldIds.filter((id) => id !== f.id) : [...hiddenFieldIds, f.id])}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
