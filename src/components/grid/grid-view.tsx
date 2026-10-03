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
import { ClipboardPaste, Copy, GripVertical, Info, Maximize2, Plus, ChevronDown, ChevronRight, Rows3 } from "lucide-react";
import { Checkbox } from "@/components/ui/misc";
import { Cell, CellDisplayValue, type Member, type LinkTarget, type OkrOptions } from "./cell";
import { FieldHeaderMenu } from "./field-header-menu";
import { AddFieldButton } from "./add-field-menu";
import { getCellValue, getConditionalStyle, type RecordGroup, type ConditionalFormatRule } from "@/lib/query-engine";
import type { FieldRow, RecordRow } from "@/types";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";
import { toast } from "@/components/ui/toast";
import {
  clipboardEntryToField,
  clipboardTextToField,
  createCellClipboardPayload,
  createRowClipboardPayload,
  isGridFieldPasteable,
  rowClipboardPatch,
  type GridClipboardPayload,
} from "@/lib/grid-clipboard";

const ROW_HEIGHTS: Record<string, number> = { short: 32, medium: 40, tall: 64 };
const DEFAULT_WIDTH = 180;
const PRIMARY_WIDTH = 220;

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
  onRowChange: (recordId: string, patch: Record<string, unknown>) => void;
  onAddRecord: () => void;
  onOpenRecord: (id: string) => void;
  onAddField: (afterFieldId: string | undefined, type: string) => void;
  onFieldAction: (fieldId: string, action: string) => void;
  onReorderFields: (orderedIds: string[]) => void;
  onResizeColumn: (fieldId: string, width: number) => void;
  onReorderRecords: (orderedIds: string[]) => void;
  reorderable: boolean;
}

type GridTarget = { kind: "cell"; recordId: string; fieldId: string } | { kind: "row"; recordId: string };
type GridContextMenu = GridTarget & { x: number; y: number };
interface GridInteractions {
  selected: GridTarget | null;
  select: (target: GridTarget) => void;
  openMenu: (target: GridTarget, event: React.MouseEvent) => void;
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
  const [selectedTarget, setSelectedTarget] = useState<GridTarget | null>(null);
  const [clipboard, setClipboard] = useState<GridClipboardPayload | null>(null);
  const [contextMenu, setContextMenu] = useState<GridContextMenu | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleColumnDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = visibleFields.map((f) => f.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
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
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(rowOrder, oldIndex, newIndex);
    setRowOrder(next);
    props.onReorderRecords(next);
  }
  const recordById = new Map(flatRecords.map((r) => [r.id, r]));
  const orderedFlatRecords = rowOrder.map((id) => recordById.get(id)).filter(Boolean) as RecordRow[];

  function displayClipboardValue(field: FieldRow, value: unknown): string {
    if (field.type === "person" || field.type === "people") {
      const ids = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
      return ids.map((id) => props.members.find((member) => member.id === id)?.name ?? "").filter(Boolean).join(", ");
    }
    if (field.type === "link") {
      const ids = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
      return ids.map((id) => props.linkTargets[field.id]?.records.find((record) => record.id === id)?.label ?? "").filter(Boolean).join(", ");
    }
    if (field.type === "okr_objective") return props.okrOptions?.objectives.find((option) => option.id === value)?.title ?? "";
    if (field.type === "okr_key_result") return props.okrOptions?.keyResults.find((option) => option.id === value)?.title ?? "";
    return CellDisplayValue(field, value);
  }

  function payloadFor(target: GridTarget): GridClipboardPayload | null {
    const record = recordById.get(target.recordId);
    if (!record) return null;
    if (target.kind === "cell") {
      const field = fields.find((candidate) => candidate.id === target.fieldId);
      if (!field) return null;
      const value = getCellValue(record, field, fields);
      return createCellClipboardPayload(field, value, displayClipboardValue(field, value));
    }
    const values = visibleFields.map((field) => getCellValue(record, field, fields));
    return createRowClipboardPayload(visibleFields, values, visibleFields.map((field, index) => displayClipboardValue(field, values[index])).join("\t"));
  }

  async function copyTarget(target: GridTarget, event?: React.ClipboardEvent) {
    const payload = payloadFor(target);
    if (!payload) return;
    setClipboard(payload);
    if (event) event.clipboardData.setData("text/plain", payload.text);
    else {
      try {
        await navigator.clipboard.writeText(payload.text);
      } catch {
        // The typed in-app clipboard remains available even if the browser denies system clipboard access.
      }
    }
    toast.success(t(payload.kind === "cell" ? "grid.cellCopied" : "grid.rowCopied"));
  }

  function pasteCell(target: Extract<GridTarget, { kind: "cell" }>, source: GridClipboardPayload | null, text: string): boolean {
    const field = fields.find((candidate) => candidate.id === target.fieldId);
    if (!field || !isGridFieldPasteable(field)) return false;
    if (source?.kind === "row") return false;
    const result = source?.kind === "cell" ? clipboardEntryToField(source.entry, field) : clipboardTextToField(text.split("\t", 1)[0] ?? "", field);
    if (!result.ok) return false;
    props.onCellChange(target.recordId, field.id, result.value);
    return true;
  }

  function pasteRow(target: Extract<GridTarget, { kind: "row" }>, source: GridClipboardPayload | null, text: string): boolean {
    if (source?.kind === "cell") return false;
    let patch = source ? rowClipboardPatch(source, fields) : null;
    if (!patch) {
      const cells = text.replace(/\r?\n[\s\S]*$/, "").split("\t");
      const parsed: Record<string, unknown> = {};
      for (const [index, field] of visibleFields.entries()) {
        if (cells[index] === undefined || !isGridFieldPasteable(field)) continue;
        const result = clipboardTextToField(cells[index], field);
        if (result.ok) parsed[field.id] = result.value;
      }
      patch = Object.keys(parsed).length ? parsed : null;
    }
    if (!patch) return false;
    props.onRowChange(target.recordId, patch);
    return true;
  }

  function applyPaste(target: GridTarget, source: GridClipboardPayload | null, text: string) {
    const pasted = target.kind === "cell" ? pasteCell(target, source, text) : pasteRow(target, source, text);
    if (!pasted) toast.error(t("grid.pasteIncompatible"));
  }

  async function pasteTarget(target: GridTarget) {
    let text = clipboard?.text ?? "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      // Browser clipboard permission is optional; an in-app copy still works.
    }
    const typedSource = clipboard?.text === text ? clipboard : null;
    applyPaste(target, typedSource, text);
  }

  function textSelectionInside(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false;
    return target.selectionStart !== null && target.selectionEnd !== null && target.selectionStart !== target.selectionEnd;
  }

  function isTextEditor(target: EventTarget | null): boolean {
    if (target instanceof HTMLTextAreaElement) return true;
    if (target instanceof HTMLInputElement) return !["checkbox", "radio", "button", "date", "datetime-local"].includes(target.type);
    return target instanceof HTMLElement && target.isContentEditable;
  }

  function handleCopy(event: React.ClipboardEvent) {
    if (!selectedTarget || textSelectionInside(event.target)) return;
    event.preventDefault();
    void copyTarget(selectedTarget, event);
  }

  function handlePaste(event: React.ClipboardEvent) {
    if (!selectedTarget || isTextEditor(event.target)) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    applyPaste(selectedTarget, clipboard?.text === text ? clipboard : null, text);
  }

  const interactions: GridInteractions = {
    selected: selectedTarget,
    select: setSelectedTarget,
    openMenu: (target, event) => {
      event.preventDefault();
      setSelectedTarget(target);
      setContextMenu({ ...target, x: event.clientX, y: event.clientY });
    },
  };

  return (
    <div className="flex-1 overflow-auto thin-scroll" onCopy={handleCopy} onPaste={handlePaste} onKeyDown={(event) => event.key === "Escape" && setContextMenu(null)}>
      {/*
        A real <table> is deliberately avoided here: dnd-kit's DndContext renders a
        hidden accessibility live-region <div>, and browsers reject a <div> as a
        child of <table>/<tbody>/<tr> (it gets hoisted out, breaking hydration).
        This grid uses ARIA table roles on plain divs instead, which behave
        identically for layout/styling but impose no HTML content-model
        restrictions on what a drag-and-drop library can render alongside them.
      */}
      <div role="table" className="text-sm inline-flex flex-col" style={{ width: "max-content", minWidth: "100%" }}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
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
        </DndContext>
        <DndContext sensors={rowSensors} collisionDetection={closestCenter} onDragEnd={handleRowDragEnd}>
          {groups ? (
            groups.map((group) => (
              <GroupSection key={group.key} group={group} {...props} visibleFields={visibleFields} widthOf={widthOf} interactions={interactions} />
            ))
          ) : props.reorderable ? (
            <SortableContext items={rowOrder} strategy={verticalListSortingStrategy}>
              {orderedFlatRecords.map((record) => (
                <Row key={record.id} record={record} {...props} visibleFields={visibleFields} widthOf={widthOf} interactions={interactions} />
              ))}
            </SortableContext>
          ) : (
            flatRecords.map((record) => <Row key={record.id} record={record} {...props} visibleFields={visibleFields} widthOf={widthOf} interactions={interactions} />)
          )}
        </DndContext>
      </div>
      <button
        onClick={() => props.onAddRecord()}
        className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-900 w-full text-left border-b border-neutral-100 dark:border-neutral-900"
      >
        <Plus size={14} /> {t("grid.addTask")}
      </button>
      {contextMenu ? (
        <GridClipboardMenu
          menu={contextMenu}
          canPasteCell={contextMenu.kind === "cell" && !!fields.find((field) => field.id === contextMenu.fieldId && isGridFieldPasteable(field))}
          canPasteRow={fields.some(isGridFieldPasteable)}
          close={() => setContextMenu(null)}
          copyCell={() => contextMenu.kind === "cell" && void copyTarget(contextMenu)}
          copyRow={() => void copyTarget({ kind: "row", recordId: contextMenu.recordId })}
          pasteCell={() => contextMenu.kind === "cell" && void pasteTarget(contextMenu)}
          pasteRow={() => void pasteTarget({ kind: "row", recordId: contextMenu.recordId })}
        />
      ) : null}
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
    interactions: GridInteractions;
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
  interactions,
  ...props
}: {
  record: RecordRow;
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
  const activeRow = interactions.selected?.kind === "row" && interactions.selected.recordId === record.id;
  const rowStyle = getConditionalStyle(record, props.fields, props.conditionalFormats, "__row__");

  return (
    <div
      role="row"
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, backgroundColor: rowStyle.rowColor ? `${rowStyle.rowColor}18` : undefined }}
      className={cn("flex group/row hover:bg-neutral-50 dark:hover:bg-neutral-900/60", isDragging && "opacity-50 z-40 relative", (selected || activeRow) && "bg-indigo-50/50 dark:bg-indigo-950/20")}
    >
      <div
        role="cell"
        onMouseDownCapture={() => interactions.select({ kind: "row", recordId: record.id })}
        onContextMenu={(event) => interactions.openMenu({ kind: "row", recordId: record.id }, event)}
        className={cn("sticky left-0 z-10 flex items-center justify-center gap-0.5 bg-white dark:bg-neutral-950 border-b border-r border-neutral-100 dark:border-neutral-900 shrink-0", activeRow && "ring-2 ring-inset ring-indigo-500")}
        style={{ height, minHeight, width: 36, minWidth: 36 }}
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
        const activeCell = interactions.selected?.kind === "cell" && interactions.selected.recordId === record.id && interactions.selected.fieldId === field.id;
        return (
          <div
            role="cell"
            key={field.id}
            onMouseDownCapture={() => interactions.select({ kind: "cell", recordId: record.id, fieldId: field.id })}
            onFocusCapture={() => interactions.select({ kind: "cell", recordId: record.id, fieldId: field.id })}
            onContextMenu={(event) => interactions.openMenu({ kind: "cell", recordId: record.id, fieldId: field.id }, event)}
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
              activeCell && "ring-2 ring-inset ring-indigo-500 z-[6]"
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

function GridClipboardMenu({
  menu,
  canPasteCell,
  canPasteRow,
  close,
  copyCell,
  copyRow,
  pasteCell,
  pasteRow,
}: {
  menu: GridContextMenu;
  canPasteCell: boolean;
  canPasteRow: boolean;
  close: () => void;
  copyCell: () => void;
  copyRow: () => void;
  pasteCell: () => void;
  pasteRow: () => void;
}) {
  const { t } = useT();
  const left = typeof window === "undefined" ? menu.x : Math.min(menu.x, window.innerWidth - 210);
  const top = typeof window === "undefined" ? menu.y : Math.min(menu.y, window.innerHeight - 190);
  const action = (handler: () => void) => () => {
    close();
    handler();
  };
  const item = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-800";
  return (
    <div className="fixed inset-0 z-[80]" onMouseDown={close} onContextMenu={(event) => { event.preventDefault(); close(); }}>
      <div role="menu" aria-label={t("grid.clipboardMenu")} className="fixed w-52 rounded-md border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-800 dark:bg-neutral-900" style={{ left, top }} onMouseDown={(event) => event.stopPropagation()}>
        {menu.kind === "cell" ? (
          <>
            <button type="button" role="menuitem" className={item} onClick={action(copyCell)}><Copy size={14} />{t("grid.copyCell")}<span className="ml-auto text-[10px] text-neutral-400">Ctrl+C</span></button>
            <button type="button" role="menuitem" className={item} disabled={!canPasteCell} onClick={action(pasteCell)}><ClipboardPaste size={14} />{t("grid.pasteCell")}<span className="ml-auto text-[10px] text-neutral-400">Ctrl+V</span></button>
            <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />
          </>
        ) : null}
        <button type="button" role="menuitem" className={item} onClick={action(copyRow)}><Rows3 size={14} />{t("grid.copyRow")}</button>
        <button type="button" role="menuitem" className={item} disabled={!canPasteRow} onClick={action(pasteRow)}><ClipboardPaste size={14} />{t("grid.pasteRow")}</button>
      </div>
    </div>
  );
}

export { CellDisplayValue };
