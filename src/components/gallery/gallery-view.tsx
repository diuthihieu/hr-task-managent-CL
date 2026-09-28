"use client";
import { useState } from "react";
import { CalendarDays, Check, CalendarPlus, MoreHorizontal, Play, Settings2, Target, Maximize2, Trash2, PanelRightOpen, Paperclip } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/misc";
import { getCellValue } from "@/lib/query-engine";
import type { GalleryConfig } from "@/lib/query-engine";
import { formatDisplayValue } from "@/lib/format";
import { parseFieldConfig } from "@/lib/field-types";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { FieldRow, RecordRow } from "@/types";
import type { Member } from "@/components/grid/cell";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";

type CellFile = { id: string; name: string; type: string };
type LegacyFile = { id: string; name: string; url: string };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp)(\?.*)?$/i;
/** The four card facts people ask for most, toggled with one click. */
const QUICK_FIELDS: { id: string; label: MessageKey }[] = [
  { id: "sys_due_date", label: "gal.f.due" },
  { id: "sys_category", label: "gal.f.category" },
  { id: "sys_progress", label: "gal.f.progress" },
  { id: "sys_objective", label: "gal.f.okr" },
];
const SIZE_MIN: Record<NonNullable<GalleryConfig["cardSize"]>, number> = { small: 180, medium: 230, large: 300 };
const COVER_H: Record<NonNullable<GalleryConfig["cardSize"]>, string> = { small: "h-24", medium: "h-32", large: "h-44" };

/** Default card fields when the view has never been configured. */
export function galleryCardFields(fields: FieldRow[], config: GalleryConfig): string[] {
  return config.cardFieldIds ?? QUICK_FIELDS.map((q) => q.id).filter((id) => fields.some((f) => f.id === id));
}

function coverOf(record: RecordRow, fields: FieldRow[], config: GalleryConfig): { src: string; name: string } | null {
  if (config.coverFieldId === "none") return null;
  const field = fields.find((f) => f.id === (config.coverFieldId || "sys_attachments"));
  if (!field) return null;
  const value = getCellValue(record, field, fields) as (CellFile | LegacyFile)[] | null;
  for (const f of value ?? []) {
    if ("type" in f && /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(f.type)) return { src: `/api/attachments/${f.id}/download?inline=1`, name: f.name };
    if ("url" in f && (IMAGE_EXT.test(f.url) || IMAGE_EXT.test(f.name))) return { src: f.url, name: f.name };
  }
  return null;
}

export function GalleryView({
  fields,
  flatRecords,
  members,
  config,
  canEdit = true,
  onOpenRecord,
  onOpenPage,
  onRecordUpdated,
  onDeleteRecord,
}: {
  fields: FieldRow[];
  flatRecords: RecordRow[];
  members: Member[];
  config: GalleryConfig;
  canEdit?: boolean;
  onOpenRecord: (id: string) => void;
  onOpenPage?: (id: string) => void;
  onRecordUpdated?: (record: RecordRow) => void;
  onDeleteRecord?: (id: string) => void;
}) {
  const { t } = useT();
  const primaryField = fields.find((f) => f.isPrimary);
  const statusField = fields.find((f) => f.id === "sys_status");
  const statusCategory = new Map((parseFieldConfig(statusField?.config ?? "{}").options ?? []).map((o) => [o.id, (o as { category?: string }).category]));
  const cardFieldIds = galleryCardFields(fields, config);
  const size = config.cardSize ?? "medium";
  const [busy, setBusy] = useState<string | null>(null);

  async function quick(id: string, action: "complete" | "start" | "plan") {
    setBusy(id);
    try {
      const rec = await api.post<RecordRow>(`/api/tasks/${id}/quick`, { action });
      onRecordUpdated?.(rec);
      toast.success(t(`cc.done.${action}` as MessageKey));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto thin-scroll p-3 sm:p-4">
      {flatRecords.length === 0 ? (
        <div className="h-full flex items-center justify-center text-sm text-neutral-400">{t("gal.noRecords")}</div>
      ) : (
        <div className="grid gap-3 items-start" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${SIZE_MIN[size]}px), 1fr))` }} data-testid="gallery-grid">
          {flatRecords.map((record) => {
            const title = primaryField ? formatDisplayValue(primaryField, getCellValue(record, primaryField, fields), members) : "";
            const cover = coverOf(record, fields, config);
            const category = statusCategory.get(String(record.data.sys_status ?? ""));
            const open = category !== "done" && category !== "cancelled";
            const attachmentsCount = ((record.data.sys_attachments as unknown[]) ?? []).length;
            return (
              <div
                key={record.id}
                role="button"
                tabIndex={0}
                onClick={() => onOpenRecord(record.id)}
                onKeyDown={(e) => e.key === "Enter" && onOpenRecord(record.id)}
                className={cn(
                  "group relative text-left rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden hover:shadow-md hover:border-neutral-300 dark:hover:border-neutral-700 transition-all flex flex-col cursor-pointer",
                  !open && "opacity-70",
                  config.fitContent === false && "h-full"
                )}
                data-testid="gallery-card"
              >
                {cover && (
                  <div className={cn(COVER_H[size], "bg-neutral-100 dark:bg-neutral-800 shrink-0 overflow-hidden")} data-testid="gallery-cover">
                    {/* eslint-disable-next-line @next/next/no-img-element -- authorized attachment route / user URL */}
                    <img src={cover.src} alt={cover.name} className={cn("h-full w-full", config.coverFit === "contain" ? "object-contain" : "object-cover")} loading="lazy" />
                  </div>
                )}
                <div className="p-3 space-y-1.5 min-w-0">
                  <div className={cn("font-medium text-neutral-900 dark:text-neutral-50", size === "small" ? "text-[13px]" : "text-sm", config.fitContent === false ? "truncate" : "line-clamp-3 break-words", !open && "line-through")}>
                    {title || t("common.untitled")}
                  </div>
                  {cardFieldIds.map((fid) => {
                    const field = fields.find((f) => f.id === fid);
                    if (!field) return null;
                    const value = getCellValue(record, field, fields);
                    return <CardFact key={fid} field={field} value={value} members={members} open={open} fit={config.fitContent !== false} />;
                  })}
                  {attachmentsCount > 0 && !cover && (
                    <div className="flex items-center gap-1 text-[11px] text-neutral-400">
                      <Paperclip size={11} /> {attachmentsCount}
                    </div>
                  )}
                </div>
                {canEdit && (
                  <div
                    className="absolute top-2 right-2 flex items-center gap-0.5 rounded-lg bg-white/95 dark:bg-neutral-900/95 border border-neutral-200 dark:border-neutral-700 shadow-sm p-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                    data-testid="gallery-actions"
                  >
                    {open && (
                      <QuickBtn title={t("cc.complete")} disabled={busy === record.id} onClick={() => quick(record.id, "complete")} testId="gal-complete">
                        <Check size={13} />
                      </QuickBtn>
                    )}
                    {open && category !== "in_progress" && (
                      <QuickBtn title={t("cc.start")} disabled={busy === record.id} onClick={() => quick(record.id, "start")} testId="gal-start">
                        <Play size={13} />
                      </QuickBtn>
                    )}
                    {open && (
                      <QuickBtn title={t("cc.plan")} disabled={busy === record.id} onClick={() => quick(record.id, "plan")} testId="gal-plan">
                        <CalendarPlus size={13} />
                      </QuickBtn>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button className="p-1 rounded-md text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t("common.more")} data-testid="gal-more">
                          <MoreHorizontal size={13} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => onOpenRecord(record.id)}>
                          <PanelRightOpen size={13} /> {t("common.open")}
                        </DropdownMenuItem>
                        {onOpenPage && (
                          <DropdownMenuItem onSelect={() => onOpenPage(record.id)}>
                            <Maximize2 size={13} /> {t("record.openAsPage")}
                          </DropdownMenuItem>
                        )}
                        {onDeleteRecord && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => onDeleteRecord(record.id)} className="text-red-600 dark:text-red-400">
                              <Trash2 size={13} /> {t("common.delete")}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function QuickBtn({ title, onClick, disabled, children, testId }: { title: string; onClick: () => void; disabled?: boolean; children: React.ReactNode; testId: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} aria-label={title} className="p-1 rounded-md text-neutral-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950 disabled:opacity-40" data-testid={testId}>
      {children}
    </button>
  );
}

/** One field on a card, rendered by what it is (date, progress, objective...) rather than as plain text. */
function CardFact({ field, value, members, open, fit }: { field: FieldRow; value: unknown; members: Member[]; open: boolean; fit: boolean }) {
  const { t } = useT();
  if (field.id === "sys_progress" || field.type === "progress") {
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    return (
      <div className="flex items-center gap-2" title={field.name}>
        <div className="h-1.5 flex-1 rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
          <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${v}%` }} />
        </div>
        <span className="text-[10px] text-neutral-400 tabular-nums">
          {t("okr.progressShort")} {v}%
        </span>
      </div>
    );
  }
  const display = formatDisplayValue(field, value, members);
  if (!display) return null;
  if (field.type === "date" || field.id === "sys_due_date" || field.id === "sys_start_date") {
    const overdue = open && field.id === "sys_due_date" && typeof value === "string" && value.slice(0, 10) < new Date().toISOString().slice(0, 10);
    return (
      <div className={cn("flex items-center gap-1 text-xs", overdue ? "text-red-600 font-medium" : "text-neutral-500 dark:text-neutral-400")} title={field.name}>
        <CalendarDays size={11} className="shrink-0" /> {display}
      </div>
    );
  }
  if (field.id === "sys_objective" || field.type === "okr_target") {
    return (
      <div className={cn("flex items-start gap-1 text-xs text-indigo-700 dark:text-indigo-300", fit ? "" : "truncate")} title={field.name}>
        <Target size={11} className="shrink-0 mt-0.5" /> <span className={fit ? "line-clamp-2" : "truncate"}>{display}</span>
      </div>
    );
  }
  if (field.id === "sys_category" || field.type === "single_select" || field.type === "status") {
    const opt = (parseFieldConfig(field.config).options ?? []).find((o) => o.id === value || o.label === value);
    return (
      <span className="inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${opt?.color ?? "#94a3b8"}22`, color: opt?.color ?? "#64748b" }} title={field.name}>
        <span className="truncate">{display}</span>
      </span>
    );
  }
  return (
    <div className={cn("text-xs text-neutral-500 dark:text-neutral-400", fit ? "line-clamp-2 break-words" : "truncate")} title={field.name}>
      {display}
    </div>
  );
}

/** Gallery settings, shown inside the view toolbar (one row of controls). */
export function GallerySettings({ fields, config, onChange }: { fields: FieldRow[]; config: GalleryConfig; onChange: (patch: Partial<GalleryConfig>) => void }) {
  const { t } = useT();
  const coverFields = fields.filter((f) => f.type === "attachment" || f.type === "task_attachments");
  const cardFieldIds = galleryCardFields(fields, config);
  const toggle = (id: string, on: boolean) => onChange({ cardFieldIds: on ? [...cardFieldIds, id] : cardFieldIds.filter((x) => x !== id) });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 h-7 px-2 rounded-md text-sm shrink-0 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800" data-testid="gallery-settings">
          <Settings2 size={13} /> {t("gal.card")}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-3" align="start">
        <div>
          <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{t("gal.size")}</label>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 p-0.5">
            {(["small", "medium", "large"] as const).map((s) => (
              <button key={s} onClick={() => onChange({ cardSize: s })} className={cn("rounded-md py-1 text-xs", (config.cardSize ?? "medium") === s ? "bg-white dark:bg-neutral-900 shadow-sm font-medium" : "text-neutral-500")} data-testid={`gal-size-${s}`}>
                {t(`gal.size.${s}` as MessageKey)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{t("gal.cover")}</label>
          <div className="flex gap-1.5">
            <Select
              className="flex-1"
              value={config.coverFieldId ?? "sys_attachments"}
              onValueChange={(v) => onChange({ coverFieldId: v })}
              options={[{ value: "none", label: t("gal.noCover") }, ...coverFields.map((f) => ({ value: f.id, label: f.name }))]}
            />
            <Select
              className="w-24"
              value={config.coverFit ?? "cover"}
              onValueChange={(v) => onChange({ coverFit: v as "cover" | "contain" })}
              options={[
                { value: "cover", label: t("gal.fit.cover") },
                { value: "contain", label: t("gal.fit.contain") },
              ]}
            />
          </div>
          <p className="text-[11px] text-neutral-400 mt-1">{t("gal.coverAuto")}</p>
        </div>
        <label className="flex items-center justify-between gap-2 text-sm">
          <span>
            {t("gal.fitContent")}
            <span className="block text-[11px] text-neutral-400">{t("gal.fitContentHint")}</span>
          </span>
          <input type="checkbox" checked={config.fitContent !== false} onChange={(e) => onChange({ fitContent: e.target.checked })} data-testid="gal-fit" />
        </label>
        <div>
          <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{t("gal.quickFields")}</label>
          <div className="flex flex-wrap gap-1">
            {QUICK_FIELDS.filter((q) => fields.some((f) => f.id === q.id)).map((q) => {
              const on = cardFieldIds.includes(q.id);
              return (
                <button key={q.id} onClick={() => toggle(q.id, !on)} className={cn("rounded-full border px-2 py-0.5 text-xs", on ? "bg-indigo-600 border-indigo-600 text-white" : "border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300")} data-testid={`gal-field-${q.id}`}>
                  {t(q.label)}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <label className="text-[11px] font-medium text-neutral-500 mb-1 block">{t("kb.cardFields")}</label>
          <div className="max-h-40 overflow-y-auto thin-scroll border border-neutral-200 dark:border-neutral-800 rounded-md p-1.5 space-y-1">
            {fields
              .filter((f) => !f.isPrimary)
              .map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
                  <input type="checkbox" checked={cardFieldIds.includes(f.id)} onChange={(e) => toggle(f.id, e.target.checked)} />
                  {f.name}
                </label>
              ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
