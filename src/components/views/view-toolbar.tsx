"use client";
import { forwardRef } from "react";
import { Search, ListFilter, ArrowUpDown, Group as GroupIcon, EyeOff, Paintbrush, Rows3, Trash2, X, Download, Copy } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { FilterPanel } from "@/components/filters/filter-panel";
import { SortPanel } from "@/components/filters/sort-panel";
import { GroupPanel } from "@/components/filters/group-panel";
import { HiddenFieldsPanel } from "@/components/filters/hidden-fields-panel";
import { FormatPanel } from "@/components/filters/format-panel";
import type { ViewConfig } from "@/lib/query-engine";
import type { FieldRow } from "@/types";
import type { Member } from "@/components/grid/cell";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

export function ViewToolbar({
  fields,
  config,
  members,
  search,
  onSearchChange,
  onConfigChange,
  selectedCount,
  onBulkDelete,
  onClearSelection,
  onExportClick,
  onSaveAsView,
  viewType = "grid",
  extra,
}: {
  /** View-specific controls (e.g. gallery card settings) kept on the same row. */
  extra?: React.ReactNode;
  fields: FieldRow[];
  config: ViewConfig;
  members: Member[];
  search: string;
  onSearchChange: (v: string) => void;
  onConfigChange: (patch: Partial<ViewConfig>) => void;
  selectedCount: number;
  onBulkDelete: () => void;
  onClearSelection: () => void;
  onExportClick: () => void;
  onSaveAsView?: () => void;
  viewType?: string;
}) {
  const { t } = useT();
  const isGrid = viewType === "grid";
  const showGenericGroup = viewType !== "kanban"; // Kanban's columns ARE the grouping, configured in its own settings
  const filterCount = config.filters?.conditions?.length ?? 0;
  const sortCount = config.sorts?.length ?? 0;
  const hiddenCount = config.hiddenFieldIds?.length ?? 0;
  const formatCount = config.conditionalFormats?.length ?? 0;

  if (selectedCount > 0) {
    return (
      <div className="flex items-center gap-3 px-3 h-10 border-b border-neutral-200 dark:border-neutral-800 bg-indigo-50 dark:bg-indigo-950/40 shrink-0">
        <span className="text-sm font-medium text-indigo-700 dark:text-indigo-300">{t("tb.selected", { count: selectedCount })}</span>
        <Button size="sm" variant="destructive" onClick={onBulkDelete}>
          <Trash2 size={12} /> {t("common.delete")}
        </Button>
        <Button size="sm" variant="secondary" onClick={onExportClick}>
          <Download size={12} /> {t("tb.exportSelected")}
        </Button>
        <button onClick={onClearSelection} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 ml-auto">
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 px-3 h-10 border-b border-neutral-200 dark:border-neutral-800 shrink-0 overflow-x-auto thin-scroll">
      <ToolbarPopover icon={<ListFilter size={13} />} label={t("tb.filter")} count={filterCount}>
        <FilterPanel
          fields={fields}
          filter={config.filters ?? { conjunction: "AND", conditions: [] }}
          members={members}
          onChange={(f) => onConfigChange({ filters: f })}
        />
      </ToolbarPopover>

      <ToolbarPopover icon={<ArrowUpDown size={13} />} label={t("tb.sort")} count={sortCount}>
        <SortPanel fields={fields} sorts={config.sorts ?? []} onChange={(s) => onConfigChange({ sorts: s })} />
      </ToolbarPopover>

      {showGenericGroup && (
        <ToolbarPopover icon={<GroupIcon size={13} />} label={t("tb.group")} count={config.group?.fieldId ? 1 : 0}>
          <GroupPanel fields={fields} group={config.group} onChange={(g) => onConfigChange({ group: g })} />
        </ToolbarPopover>
      )}

      {isGrid && (
        <ToolbarPopover icon={<EyeOff size={13} />} label={t("tb.fields")} count={hiddenCount}>
          <HiddenFieldsPanel fields={fields} hiddenFieldIds={config.hiddenFieldIds ?? []} onChange={(ids) => onConfigChange({ hiddenFieldIds: ids })} />
        </ToolbarPopover>
      )}

      {isGrid && (
        <ToolbarPopover icon={<Paintbrush size={13} />} label={t("tb.colors")} count={formatCount}>
          <FormatPanel fields={fields} rules={config.conditionalFormats ?? []} members={members} onChange={(r) => onConfigChange({ conditionalFormats: r })} />
        </ToolbarPopover>
      )}

      {isGrid && (
        <Popover>
          <PopoverTrigger asChild>
            <ToolbarButton icon={<Rows3 size={13} />} label={t("tb.rowHeight")} />
          </PopoverTrigger>
          <PopoverContent className="w-44 p-1">
            {(
              [
                ["short", t("tb.row.short")],
                ["medium", t("tb.row.medium")],
                ["tall", t("tb.row.tall")],
                ["auto", t("tb.row.auto")],
              ] as const
            ).map(([h, label]) => (
              <button
                key={h}
                onClick={() => onConfigChange({ rowHeight: h })}
                className={cn(
                  "w-full text-left px-2 py-1.5 rounded-sm text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800",
                  (config.rowHeight ?? "medium") === h && "font-semibold text-indigo-600"
                )}
              >
                {label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      )}

      {extra}

      <div className="ml-auto flex items-center gap-1.5 shrink-0">
        {onSaveAsView && (
          <ToolbarButton
            icon={<Copy size={13} />}
            label={t("tb.saveAsView")}
            onClick={onSaveAsView}
            title={t("tb.saveAsViewHint")}
          />
        )}
        <ToolbarButton icon={<Download size={13} />} label={t("tb.export")} onClick={onExportClick} />
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-neutral-400" />
          <Input value={search} onChange={(e) => onSearchChange(e.target.value)} placeholder={t("tb.search")} className="w-32 sm:w-44 pl-7" />
        </div>
        {isGrid && (
          <Select
            className="w-24"
            value={String(config.frozenCount ?? 1)}
            onValueChange={(v) => onConfigChange({ frozenCount: Number(v) })}
            options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: n === 0 ? t("tb.noFreeze") : t("tb.freeze", { n }) }))}
          />
        )}
      </div>
    </div>
  );
}

function ToolbarPopover({ icon, label, count, children }: { icon: React.ReactNode; label: string; count: number; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarButton icon={icon} label={label} count={count} />
      </PopoverTrigger>
      <PopoverContent>{children}</PopoverContent>
    </Popover>
  );
}

const ToolbarButton = forwardRef<HTMLButtonElement, { icon: React.ReactNode; label: string; count?: number } & React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ icon, label, count, className, ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "flex items-center gap-1.5 h-7 px-2 rounded-md text-sm shrink-0",
        count ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800",
        className
      )}
      {...props}
    >
      {icon}
      {label}
      {!!count && <span className="text-[10px] bg-indigo-600 text-white rounded-full h-4 w-4 flex items-center justify-center">{count}</span>}
    </button>
  )
);
ToolbarButton.displayName = "ToolbarButton";
