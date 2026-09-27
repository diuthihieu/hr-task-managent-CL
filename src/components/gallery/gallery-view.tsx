"use client";
import { useState } from "react";
import { ImageOff, Paperclip, Settings2 } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select } from "@/components/ui/misc";
import { getCellValue } from "@/lib/query-engine";
import type { GalleryConfig } from "@/lib/query-engine";
import type { AttachmentValue } from "@/lib/field-types";
import { formatDisplayValue } from "@/lib/format";
import type { FieldRow, RecordRow } from "@/types";
import type { Member } from "@/components/grid/cell";
import { useT } from "@/components/i18n-provider";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)(\?.*)?$/i;

export function GalleryView({
  fields,
  flatRecords,
  members,
  config,
  onConfigChange,
  onOpenRecord,
}: {
  fields: FieldRow[];
  flatRecords: RecordRow[];
  members: Member[];
  config: GalleryConfig;
  onConfigChange: (patch: Partial<GalleryConfig>) => void;
  onOpenRecord: (id: string) => void;
}) {
  const { t } = useT();
  const attachmentFields = fields.filter((f) => f.type === "attachment");
  const coverField = fields.find((f) => f.id === config.coverFieldId);
  const primaryField = fields.find((f) => f.isPrimary);
  const cardFieldIds = config.cardFieldIds ?? fields.filter((f) => !f.isPrimary && f.visible).slice(0, 4).map((f) => f.id);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-neutral-100 dark:border-neutral-900 shrink-0">
        <GallerySettings fields={fields} attachmentFields={attachmentFields} config={{ ...config, cardFieldIds }} onChange={onConfigChange} />
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll p-4">
        {flatRecords.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-neutral-400">{t("gal.noRecords")}</div>
        ) : (
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
            {flatRecords.map((record) => (
              <GalleryCard
                key={record.id}
                record={record}
                fields={fields}
                primaryField={primaryField}
                coverField={coverField}
                cardFieldIds={cardFieldIds}
                members={members}
                onOpen={() => onOpenRecord(record.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function GalleryCard({
  record,
  fields,
  primaryField,
  coverField,
  cardFieldIds,
  members,
  onOpen,
}: {
  record: RecordRow;
  fields: FieldRow[];
  primaryField: FieldRow | undefined;
  coverField: FieldRow | undefined;
  cardFieldIds: string[];
  members: Member[];
  onOpen: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const title = primaryField ? formatDisplayValue(primaryField, getCellValue(record, primaryField, fields), members) : "(untitled)";
  const attachments = coverField ? (getCellValue(record, coverField, fields) as AttachmentValue[] | null) : null;
  const cover = attachments?.[0];
  const isImage = cover && (IMAGE_EXT.test(cover.url) || IMAGE_EXT.test(cover.name));

  return (
    <button
      onClick={onOpen}
      className="text-left rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden hover:shadow-md hover:border-neutral-300 dark:hover:border-neutral-700 transition-all flex flex-col"
    >
      <div className="h-32 bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0 overflow-hidden">
        {cover && isImage && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element -- cover images come from arbitrary user-pasted URLs, not local/optimizable assets
          <img src={cover.url} alt={cover.name} className="h-full w-full object-cover" onError={() => setImgError(true)} />
        ) : cover ? (
          <div className="flex flex-col items-center gap-1 text-neutral-400">
            <Paperclip size={20} />
            <span className="text-[11px] truncate max-w-[160px]">{cover.name}</span>
          </div>
        ) : (
          <ImageOff size={22} className="text-neutral-300 dark:text-neutral-700" />
        )}
      </div>
      <div className="p-2.5 space-y-1">
        <div className="text-sm font-medium text-neutral-900 dark:text-neutral-50 truncate">{title || "(untitled)"}</div>
        {cardFieldIds.map((fid) => {
          const field = fields.find((f) => f.id === fid);
          if (!field) return null;
          const value = getCellValue(record, field, fields);
          const display = formatDisplayValue(field, value, members);
          if (!display) return null;
          return (
            <div key={fid} className="text-xs text-neutral-500 dark:text-neutral-400 truncate">
              {display}
            </div>
          );
        })}
      </div>
    </button>
  );
}

function GallerySettings({
  fields,
  attachmentFields,
  config,
  onChange,
}: {
  fields: FieldRow[];
  attachmentFields: FieldRow[];
  config: GalleryConfig;
  onChange: (patch: Partial<GalleryConfig>) => void;
}) {
  const { t } = useT();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 h-7 px-2 rounded-md text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <Settings2 size={13} /> {t("gal.settings")}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-2.5">
        <div>
          <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{t("gal.cover")}</label>
          <Select
            className="w-full"
            value={config.coverFieldId ?? ""}
            onValueChange={(v) => onChange({ coverFieldId: v || undefined })}
            options={[{ value: "", label: t("common.none") }, ...attachmentFields.map((f) => ({ value: f.id, label: f.name }))]}
            placeholder={t("common.none")}
          />
          {attachmentFields.length === 0 && <p className="text-[11px] text-neutral-400 mt-1">{t("gal.coverHint")}</p>}
        </div>
        <div>
          <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{t("kb.cardFields")}</label>
          <div className="max-h-40 overflow-y-auto thin-scroll border border-neutral-200 dark:border-neutral-800 rounded-md p-1.5 space-y-1">
            {fields.map((f) => {
              const checked = config.cardFieldIds?.includes(f.id) ?? false;
              return (
                <label key={f.id} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const current = config.cardFieldIds ?? [];
                      onChange({ cardFieldIds: e.target.checked ? [...current, f.id] : current.filter((id) => id !== f.id) });
                    }}
                  />
                  {f.name}
                </label>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
