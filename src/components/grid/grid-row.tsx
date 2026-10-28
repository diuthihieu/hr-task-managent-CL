"use client";
// The grid's header cells, group sections and task rows.
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ListTree, GripVertical, Info, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/misc";
import { Cell } from "./cell";
import { FieldHeaderMenu } from "./field-header-menu";
import { getCellValue, getConditionalStyle, type RecordGroup } from "@/lib/query-engine";
import type { FieldRow, RecordRow } from "@/types";
import { cn } from "@/lib/utils";
import { RecordOpenButtons, revealOn } from "@/components/grid/record-open-buttons";
import { useT } from "@/components/i18n-provider";
import { type TreeRow } from "@/lib/task-tree";
import { inRange } from "@/lib/grid-selection";
import { ROW_HEIGHTS, TREE_STEP, type GridInteractions, type GridViewProps } from "./grid-shared";

export function HeaderCell({
  field,
  width,
  frozen,
  frozenOffset,
  onAction,
  onResizeStart,
}: {
  field: FieldRow;
  width: number;
  frozen: boolean;
  frozenOffset: number;
  onAction: (action: string) => void;
  onResizeStart: (e: React.MouseEvent) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: field.id });
  return (
    <div
      role="columnheader"
      id={`col-${field.id}`}
      ref={setNodeRef}
      style={{
        width,
        minWidth: width,
        height: 32,
        transform: CSS.Transform.toString(transform),
        transition,
        position: frozen ? "sticky" : undefined,
        left: frozen ? frozenOffset : undefined,
        zIndex: frozen ? 25 : undefined,
      }}
      className={cn(
        "relative border-b border-r border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-left group shrink-0",
        isDragging && "opacity-50"
      )}
    >
      <div className="flex items-center gap-1 h-8 px-2">
        <span {...attributes} {...listeners} className="cursor-grab text-neutral-300 opacity-0 group-hover:opacity-100 shrink-0">
          <GripVertical size={12} />
        </span>
        <span className="truncate text-xs font-medium text-neutral-600 dark:text-neutral-300 flex-1" title={field.description ? `${field.name}\n${field.description}` : field.name}>
          {field.name}
          {field.description && <Info size={10} className="inline ml-1 -mt-0.5 text-neutral-400" />}
        </span>
        <FieldHeaderMenu field={field} onAction={onAction} />
      </div>
      <div
        onMouseDown={onResizeStart}
        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-indigo-400/60"
      />
    </div>
  );
}

export function GroupSection(
  props: {
    group: RecordGroup;
    treeRows: TreeRow<RecordRow>[];
    open: boolean;
    onToggle: () => void;
    visibleFields: FieldRow[];
    widthOf: (f: FieldRow) => number;
    interactions: GridInteractions;
  } & GridViewProps
) {
  const { group, open, onToggle, treeRows, ...rowProps } = props;
  const { t } = useT();
  return (
    <>
      <div role="row" className="bg-neutral-100 dark:bg-neutral-800/60 border-b border-neutral-200 dark:border-neutral-800 px-2 py-1.5" style={{ width: "100%" }}>
        {/* Sticky so the group name stays in view while the grid scrolls sideways. */}
        <button onClick={onToggle} className="sticky left-2 w-max flex items-center gap-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-200" data-testid="group-header">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {group.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: group.color }} />}
          {group.label}
          <span className="text-neutral-400 font-normal">{group.records.length}</span>
          {group.aggregate !== undefined && <span className="text-neutral-400 font-normal ml-2">Σ {group.aggregate.toLocaleString()}</span>}
        </button>
      </div>
      {open && treeRows.map((r) => <Row key={r.record.id} record={r.record} depth={r.depth} childCount={r.childCount} {...rowProps} />)}
      {open ? (
        <button
          type="button"
          onClick={() => rowProps.onAddRecord(rowProps.interactions.groupData(group.key, group.records[0]))}
          className="sticky left-0 flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900 text-left border-b border-neutral-100 dark:border-neutral-900"
          data-testid="group-add-task"
        >
          <Plus size={12} /> {t("grid.addToGroup", { group: group.label })}
        </button>
      ) : null}
    </>
  );
}

export function Row({
  record,
  depth = 0,
  childCount = 0,
  visibleFields,
  widthOf,
  frozenCount,
  interactions,
  ...props
}: {
  record: RecordRow;
  depth?: number;
  childCount?: number;
  visibleFields: FieldRow[];
  widthOf: (f: FieldRow) => number;
  frozenCount: number;
  interactions: GridInteractions;
} & GridViewProps) {
  const { t } = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: record.id, disabled: !props.reorderable });
  const autoFit = props.rowHeight === "auto";
  const height = autoFit ? undefined : ROW_HEIGHTS[props.rowHeight] ?? 36;
  const minHeight = autoFit ? ROW_HEIGHTS.short : undefined;
  const selected = props.selectedIds.has(record.id);
  const { selection, range } = interactions;
  const rowIdx = interactions.rowIndex.get(record.id) ?? -1;
  const rowsMode = selection?.kind === "rows";
  const activeRow = rowsMode && !!range && rowIdx >= range.top && rowIdx <= range.bottom;
  // A range of more than one cell is tinted; the focus cell always gets the ring.
  const tintRange = !!range && !rowsMode && (range.top !== range.bottom || range.left !== range.right);
  const rowStyle = getConditionalStyle(record, props.fields, props.conditionalFormats, "__row__");

  return (
    <div
      role="row"
      ref={setNodeRef}
      data-record-id={record.id}
      aria-selected={activeRow || undefined}
      style={{ transform: CSS.Transform.toString(transform), transition, backgroundColor: rowStyle.rowColor ? `${rowStyle.rowColor}18` : undefined }}
      className={cn("flex group/row hover:bg-neutral-50 dark:hover:bg-neutral-900/60", isDragging && "opacity-50 z-40 relative", (selected || activeRow) && "bg-indigo-50/50 dark:bg-indigo-950/20")}
    >
      <div
        role="cell"
        onMouseDownCapture={(event) => interactions.rowMouseDown(event, record.id)}
        onContextMenu={interactions.openMenu}
        className={cn("sticky left-0 z-10 flex items-center justify-center gap-0.5 bg-white dark:bg-neutral-950 border-b border-r border-neutral-100 dark:border-neutral-900 shrink-0", activeRow && "ring-2 ring-inset ring-indigo-500")}
        style={{ height, minHeight, width: 36, minWidth: 36 }}
        data-testid="row-handle"
      >
        <span {...attributes} {...listeners} className={cn("text-neutral-300 shrink-0", props.reorderable ? "cursor-grab opacity-0 group-hover/row:opacity-100" : "opacity-0")}>
          <GripVertical size={12} />
        </span>
        <Checkbox checked={selected} onCheckedChange={() => props.onToggleSelect(record.id)} />
      </div>
      {visibleFields.map((field, idx) => {
        const value = getCellValue(record, field, props.fields);
        const style = getConditionalStyle(record, props.fields, props.conditionalFormats, field.id);
        const frozen = idx < frozenCount;
        const frozenOffset = visibleFields.slice(0, idx).reduce((s, f) => s + widthOf(f), 0) + 36;
        const key = { recordId: record.id, fieldId: field.id };
        const focusCell = selection?.kind === "cells" && selection.focus.recordId === record.id && selection.focus.fieldId === field.id;
        const inSelection = tintRange && inRange(range!, rowIdx, idx);
        return (
          <div
            role="cell"
            key={field.id}
            data-selected={inSelection || focusCell || undefined}
            data-field-id={field.id}
            onMouseDownCapture={(event) => interactions.cellMouseDown(event, key)}
            onMouseEnter={(event) => interactions.cellMouseEnter(event, key)}
            onFocusCapture={() => interactions.cellFocus(key)}
            onContextMenu={interactions.openMenu}
            style={{
              width: widthOf(field),
              minWidth: widthOf(field),
              height,
              minHeight,
              backgroundColor: style.backgroundColor ? `${style.backgroundColor}30` : undefined,
              position: frozen ? "sticky" : undefined,
              left: frozen ? frozenOffset : undefined,
              zIndex: frozen ? 5 : undefined,
            }}
            className={cn(
              "shrink-0 border-b border-r border-neutral-100 dark:border-neutral-900 relative",
              frozen && !style.backgroundColor && "bg-white dark:bg-neutral-950",
              inSelection && "after:pointer-events-none after:absolute after:inset-0 after:bg-indigo-500/10 dark:after:bg-indigo-400/15",
              focusCell && "ring-2 ring-inset ring-indigo-500 z-[6]"
            )}
          >
            <div className={cn("flex", autoFit ? "items-start" : "h-full items-center")}>
              {field.isPrimary && interactions.tree.indent && (
                // One step per parent level with tree guide lines (├─) so sub-tasks read clearly as children,
                // then the expand / collapse chevron (or its empty slot).
                <span className={cn("relative flex shrink-0 self-stretch items-center", autoFit && "pt-2 items-start")} style={{ paddingLeft: depth * TREE_STEP }} data-depth={depth}>
                  {Array.from({ length: depth }, (_, level) => (
                    <span
                      key={level}
                      aria-hidden
                      className={cn("pointer-events-none absolute top-0 bottom-0 border-l", level === depth - 1 ? "border-indigo-300 dark:border-indigo-700" : "border-neutral-200 dark:border-neutral-700")}
                      style={{ left: level * TREE_STEP + TREE_STEP / 2 }}
                    />
                  ))}
                  {depth > 0 ? (
                    <span aria-hidden className="pointer-events-none absolute border-t border-indigo-300 dark:border-indigo-700" style={{ left: (depth - 1) * TREE_STEP + TREE_STEP / 2, width: TREE_STEP / 2 + 2, top: autoFit ? 18 : "50%" }} data-testid="subtask-connector" />
                  ) : null}
                  {childCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => interactions.tree.toggle(record.id)}
                      className="relative flex h-5 w-5 items-center justify-center rounded text-indigo-600 hover:bg-indigo-100/70 dark:text-indigo-300 dark:hover:bg-indigo-900/60"
                      aria-label={t(interactions.tree.collapsed.has(record.id) ? "grid.expandSubtasks" : "grid.collapseSubtasks", { n: childCount })}
                      aria-expanded={!interactions.tree.collapsed.has(record.id)}
                      data-testid="subtask-toggle"
                    >
                      {interactions.tree.collapsed.has(record.id) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </button>
                  ) : (
                    <span className="w-5" />
                  )}
                  {childCount > 0 ? (
                    <span className="ml-0.5 rounded-full bg-indigo-50 px-1.5 text-[10px] font-medium leading-4 text-indigo-700 tabular-nums dark:bg-indigo-950 dark:text-indigo-300" title={t("grid.subtaskCount", { n: childCount })} data-testid="subtask-count">
                      {childCount}
                    </span>
                  ) : null}
                </span>
              )}
              {field.isPrimary && (
                <RecordOpenButtons
                  onOpen={() => props.onOpenRecord(record.id)}
                  onOpenPage={props.onOpenPage ? () => props.onOpenPage?.(record.id) : undefined}
                  className={cn("ml-1", autoFit && "mt-2", revealOn.row)}
                />
              )}
              {field.isPrimary && (
                <button
                  type="button"
                  onClick={() => interactions.tree.addSubtask(record.id)}
                  // Floats over the cell's right edge (on row hover) so it never takes room from the title.
                  className={cn("absolute right-1 z-[7] flex max-md:hidden h-6 w-6 items-center justify-center rounded border border-neutral-200 bg-white text-neutral-500 shadow-sm hover:text-indigo-600 dark:border-neutral-700 dark:bg-neutral-900", autoFit ? "top-1.5" : "top-1/2 -translate-y-1/2", revealOn.row)}
                  title={t("grid.addSubtask")}
                  aria-label={t("grid.addSubtask")}
                  data-testid="add-subtask"
                >
                  <ListTree size={13} />
                </button>
              )}
              <div className={cn("flex-1 overflow-hidden", autoFit ? "" : "h-full", field.isPrimary && autoFit && "md:pr-7", field.isPrimary && childCount > 0 && "[&_input]:font-semibold [&_textarea]:font-semibold", field.isPrimary && depth > 0 && "[&_input]:text-neutral-700 [&_textarea]:text-neutral-700 dark:[&_input]:text-neutral-300 dark:[&_textarea]:text-neutral-300")}>
                <Cell
                  field={field}
                  value={value}
                  record={record}
                  members={props.members}
                  linkTargets={props.linkTargets}
                  okrOptions={props.okrOptions}
                  wrapText={autoFit}
                  columnWidth={widthOf(field)}
                  onChange={(v) => props.onCellChange(record.id, field.id, v)}
                />
              </div>
            </div>
          </div>
        );
      })}
      <div role="cell" className="shrink-0 border-b border-neutral-100 dark:border-neutral-900" style={{ width: 40, minWidth: 40 }} />
    </div>
  );
}
