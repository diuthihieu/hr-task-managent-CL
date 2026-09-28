"use client";
import { useMemo, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Info, Maximize2, Plus, ChevronDown, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/misc";
import { Cell, CellDisplayValue, type Member, type LinkTarget, type OkrOptions } from "./cell";
import { FieldHeaderMenu } from "./field-header-menu";
import { AddFieldButton } from "./add-field-menu";
import { getCellValue, getConditionalStyle, type RecordGroup, type ConditionalFormatRule } from "@/lib/query-engine";
import type { FieldRow, RecordRow } from "@/types";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";

const ROW_HEIGHTS: Record<string, number> = { short: 32, medium: 40, tall: 64 };
const DEFAULT_WIDTH = 180;
const PRIMARY_WIDTH = 220;
const AUTO_FIT_MAX_HEIGHT = 180; // cap so one very long value can't blow up the whole table

interface GridViewProps {
  fields: FieldRow[];
  groups: RecordGroup[] | null;
  flatRecords: RecordRow[];
  members: Member[];
  linkTargets: Record<string, LinkTarget>;
  okrOptions?: OkrOptions;
  hiddenFieldIds: string[];
  columnOrder: string[];
  columnWidths: Record<string, number>;
  frozenCount: number;
  rowHeight: "short" | "medium" | "tall" | "auto";
  conditionalFormats: ConditionalFormatRule[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: (ids: string[]) => void;
  onCellChange: (recordId: string, fieldId: string, value: unknown) => void;
  onAddRecord: () => void;
  onOpenRecord: (id: string) => void;
  onAddField: (afterFieldId: string | undefined, type: string) => void;
  onFieldAction: (fieldId: string, action: string) => void;
  onReorderFields: (orderedIds: string[]) => void;
  onResizeColumn: (fieldId: string, width: number) => void;
  onReorderRecords: (orderedIds: string[]) => void;
  reorderable: boolean;
}

export function GridView(props: GridViewProps) {
  const { t } = useT();
  const {
    fields,
    groups,
    flatRecords,
    columnOrder,
    hiddenFieldIds,
    columnWidths,
    frozenCount,
    onReorderFields,
    onResizeColumn,
  } = props;

  const visibleFields = useMemo(() => {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const ordered = columnOrder.length ? columnOrder.map((id) => byId.get(id)).filter(Boolean) as FieldRow[] : fields;
    const extra = fields.filter((f) => !ordered.includes(f));
    return [...ordered, ...extra].filter((f) => !hiddenFieldIds.includes(f.id));
  }, [fields, columnOrder, hiddenFieldIds]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleColumnDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = visibleFields.map((f) => f.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    onReorderFields(arrayMove(ids, oldIndex, newIndex));
  }

  function startResize(fieldId: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startWidth = columnWidths[fieldId] ?? (fields.find((f) => f.id === fieldId)?.isPrimary ? PRIMARY_WIDTH : DEFAULT_WIDTH);
    const startX = e.clientX;
    function onMove(ev: MouseEvent) {
      const el = document.getElementById(`col-${fieldId}`);
      if (el) {
        const w = Math.max(90, startWidth + (ev.clientX - startX));
        el.style.width = `${w}px`;
        el.style.minWidth = `${w}px`;
      }
    }
    function onUp(ev: MouseEvent) {
      const w = Math.max(90, startWidth + (ev.clientX - startX));
      onResizeColumn(fieldId, w);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function widthOf(field: FieldRow) {
    return columnWidths[field.id] ?? (field.isPrimary ? PRIMARY_WIDTH : DEFAULT_WIDTH);
  }

  const allIds = flatRecords.map((r) => r.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => props.selectedIds.has(id));

  // Row drag-to-reorder state lives here (not inside <tbody>) because DndContext
  // renders a hidden accessibility live-region <div>, which is invalid HTML as a
  // direct child of <tbody>/<tr> and triggers a hydration error there.
  const rowSensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [rowOrder, setRowOrder] = useState(flatRecords.map((r) => r.id));
  if (rowOrder.length !== flatRecords.length || !flatRecords.every((r) => rowOrder.includes(r.id))) {
    setRowOrder(flatRecords.map((r) => r.id));
  }
  function handleRowDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = rowOrder.indexOf(String(active.id));
    const newIndex = rowOrder.indexOf(String(over.id));
    const next = arrayMove(rowOrder, oldIndex, newIndex);
    setRowOrder(next);
    props.onReorderRecords(next);
  }
  const recordById = new Map(flatRecords.map((r) => [r.id, r]));
  const orderedFlatRecords = rowOrder.map((id) => recordById.get(id)).filter(Boolean) as RecordRow[];

  return (
    <div className="flex-1 overflow-auto thin-scroll">
      {/*
        A real <table> is deliberately avoided here: dnd-kit's DndContext renders a
        hidden accessibility live-region <div>, and browsers reject a <div> as a
        child of <table>/<tbody>/<tr> (it gets hoisted out, breaking hydration).
        This grid uses ARIA table roles on plain divs instead, which behave
        identically for layout/styling but impose no HTML content-model
        restrictions on what a drag-and-drop library can render alongside them.
      */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
        <DndContext sensors={rowSensors} collisionDetection={closestCenter} onDragEnd={handleRowDragEnd}>
          <div role="table" className="text-sm inline-flex flex-col" style={{ width: "max-content", minWidth: "100%" }}>
            <div role="row" className="flex sticky top-0 z-20 bg-neutral-50 dark:bg-neutral-900">
              <div role="columnheader" className="sticky left-0 z-30 flex items-center justify-center bg-neutral-50 dark:bg-neutral-900 border-b border-r border-neutral-200 dark:border-neutral-800" style={{ width: 36, minWidth: 36, height: 32 }}>
                <Checkbox checked={allSelected} onCheckedChange={() => props.onToggleSelectAll(allIds)} />
              </div>
              <SortableContext items={visibleFields.map((f) => f.id)} strategy={horizontalListSortingStrategy}>
                {visibleFields.map((field, idx) => (
                  <HeaderCell
                    key={field.id}
                    field={field}
                    width={widthOf(field)}
                    frozen={idx < frozenCount}
                    frozenOffset={visibleFields.slice(0, idx).reduce((s, f) => s + widthOf(f), 0) + 36}
                    onAction={(action) => props.onFieldAction(field.id, action)}
                    onResizeStart={(e) => startResize(field.id, e)}
                  />
                ))}
              </SortableContext>
              <div role="columnheader" className="flex items-center border-b border-neutral-200 dark:border-neutral-800" style={{ width: 40, minWidth: 40 }}>
                <AddFieldButton onSelect={(type) => props.onAddField(visibleFields[visibleFields.length - 1]?.id, type)} />
              </div>
            </div>
            {groups ? (
              groups.map((group) => (
                <GroupSection key={group.key} group={group} {...props} visibleFields={visibleFields} widthOf={widthOf} />
              ))
            ) : props.reorderable ? (
              <SortableContext items={rowOrder} strategy={verticalListSortingStrategy}>
                {orderedFlatRecords.map((record) => (
                  <Row key={record.id} record={record} {...props} visibleFields={visibleFields} widthOf={widthOf} />
                ))}
              </SortableContext>
            ) : (
              flatRecords.map((record) => <Row key={record.id} record={record} {...props} visibleFields={visibleFields} widthOf={widthOf} />)
            )}
          </div>
        </DndContext>
      </DndContext>
      <button
        onClick={() => props.onAddRecord()}
        className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-900 w-full text-left border-b border-neutral-100 dark:border-neutral-900"
      >
        <Plus size={14} /> {t("grid.addTask")}
      </button>
    </div>
  );
}

function HeaderCell({
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

function GroupSection(
  props: {
    group: RecordGroup;
    visibleFields: FieldRow[];
    widthOf: (f: FieldRow) => number;
  } & GridViewProps
) {
  const [open, setOpen] = useState(true);
  const { group } = props;
  return (
    <>
      <div role="row" className="bg-neutral-100 dark:bg-neutral-800/60 border-b border-neutral-200 dark:border-neutral-800 px-2 py-1.5" style={{ width: "100%" }}>
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {group.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: group.color }} />}
          {group.label}
          <span className="text-neutral-400 font-normal">{group.records.length}</span>
          {group.aggregate !== undefined && <span className="text-neutral-400 font-normal ml-2">Σ {group.aggregate.toLocaleString()}</span>}
        </button>
      </div>
      {open &&
        group.records.map((record) => (
          <Row key={record.id} record={record} {...props} />
        ))}
    </>
  );
}

function Row({
  record,
  visibleFields,
  widthOf,
  frozenCount,
  ...props
}: {
  record: RecordRow;
  visibleFields: FieldRow[];
  widthOf: (f: FieldRow) => number;
  frozenCount: number;
} & GridViewProps) {
  const { t } = useT();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: record.id, disabled: !props.reorderable });
  const autoFit = props.rowHeight === "auto";
  const height = autoFit ? undefined : ROW_HEIGHTS[props.rowHeight] ?? 36;
  const minHeight = autoFit ? ROW_HEIGHTS.short : undefined;
  const selected = props.selectedIds.has(record.id);
  const rowStyle = getConditionalStyle(record, props.fields, props.conditionalFormats, "__row__");

  return (
    <div
      role="row"
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, backgroundColor: rowStyle.rowColor ? `${rowStyle.rowColor}18` : undefined }}
      className={cn("flex group/row hover:bg-neutral-50 dark:hover:bg-neutral-900/60", isDragging && "opacity-50 z-40 relative", selected && "bg-indigo-50/50 dark:bg-indigo-950/20")}
    >
      <div role="cell" className="sticky left-0 z-10 flex items-center justify-center gap-0.5 bg-white dark:bg-neutral-950 border-b border-r border-neutral-100 dark:border-neutral-900 shrink-0" style={{ height, minHeight, width: 36, minWidth: 36 }}>
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
        return (
          <div
            role="cell"
            key={field.id}
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
              frozen && !style.backgroundColor && "bg-white dark:bg-neutral-950"
            )}
          >
            <div className={cn("flex", autoFit ? "items-start" : "h-full items-center")}>
              {field.isPrimary && (
                <button
                  onClick={() => props.onOpenRecord(record.id)}
                  className={cn("opacity-0 group-hover/row:opacity-100 shrink-0 ml-1 text-neutral-400 hover:text-indigo-600", autoFit && "mt-2")}
                  title={t("grid.expand")}
                >
                  <Maximize2 size={12} />
                </button>
              )}
              <div className={cn("flex-1 overflow-hidden", autoFit ? "" : "h-full")}>
                <Cell
                  field={field}
                  value={value}
                  record={record}
                  members={props.members}
                  linkTargets={props.linkTargets}
                  okrOptions={props.okrOptions}
                  wrapText={autoFit}
                  maxHeight={autoFit ? AUTO_FIT_MAX_HEIGHT : undefined}
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

export { CellDisplayValue };
