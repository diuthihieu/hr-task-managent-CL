"use client";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { ArrowDownToLine, ArrowRightLeft, ClipboardPaste, CopyPlus, ListTree, Copy, GripVertical, Info, Plus, ChevronDown, ChevronRight, Rows3, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/misc";
import { Cell, CellDisplayValue, type Member, type LinkTarget, type OkrOptions } from "./cell";
import { FieldHeaderMenu } from "./field-header-menu";
import { AddFieldButton } from "./add-field-menu";
import { getCellValue, getConditionalStyle, type RecordGroup, type ConditionalFormatRule } from "@/lib/query-engine";
import type { FieldRow, RecordRow } from "@/types";
import { cn } from "@/lib/utils";
import { RecordOpenButtons, revealOn } from "@/components/grid/record-open-buttons";
import { useT } from "@/components/i18n-provider";
import { toast } from "@/components/ui/toast";
import {
  clipboardEntryToField,
  clipboardTextToField,
  createClipboardPayload,
  isGridFieldPasteable,
  matchColumn,
  normalizeClipboardText,
  parseTsv,
  sanitizeForTarget,
  type ClipboardValueResult,
  type GridClipboardPayload,
  type PasteTargetContext,
  type TextLookup,
} from "@/lib/grid-clipboard";
import { getGridClipboard, setGridClipboard } from "@/lib/grid-clipboard-store";
import { buildTaskTree, type TreeRow } from "@/lib/task-tree";
import { inRange, normalizeRange, planFillDown, planPaste, rangeCols, rangeRows, type CellRange } from "@/lib/grid-selection";
import { parseFieldConfig } from "@/lib/field-types";
import { groupFieldPatch } from "@/lib/grid-group";
import { orderVisibleFields } from "@/lib/grid-columns";

const ROW_HEIGHTS: Record<string, number> = { short: 32, medium: 40, tall: 64 };
const DEFAULT_WIDTH = 180;
const PRIMARY_WIDTH = 220;
/** One paste writes at most this many rows, so a stray clipboard cannot flood a project. */
const MAX_PASTE_ROWS = 500;
/** "Insert rows" adds at most this many at once (the server enforces the same limit). */
const MAX_INSERT_ROWS = 50;
/** Indent per sub-task level in the name column (px). */
const TREE_STEP = 22;

export interface GridBulkChange {
  updates: { recordId: string; patch: Record<string, unknown> }[];
  creates: Record<string, unknown>[];
}

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
  /** Writes many cells / new rows at once (paste, fill down); resolves with what was saved. */
  onBulkChange: (change: GridBulkChange) => Promise<{ updated: number; created: number; failed: number }>;
  /** Move / duplicate whole tasks (with comments and files) into another project. */
  onTransferTasks?: (taskIds: string[], mode: "move" | "duplicate") => void;
  /** Adds a task; `initialData` pre-fills it (e.g. { sys_parent: [id] } for a sub-task). */
  onAddRecord: (initialData?: Record<string, unknown>) => void;
  /** Inserts `count` new tasks right above / below a task, each starting with `data`. */
  onInsertRows?: (anchorId: string, position: "above" | "below", count: number, data: Record<string, unknown>) => Promise<void>;
  /** Deletes these tasks (after the grid asked the user to confirm). */
  onDeleteRecords?: (ids: string[]) => Promise<void>;
  /** The field the view is grouped by: new rows added inside a group take that group's value. */
  groupFieldId?: string;
  /** Scroll to this task and focus its name cell (e.g. right after "+ New task"); `onFocused` then clears it. */
  focusRecordId?: string | null;
  onFocused?: () => void;
  onOpenRecord: (id: string) => void;
  onOpenPage?: (id: string) => void;
  onAddField: (afterFieldId: string | undefined, type: string) => void;
  onFieldAction: (fieldId: string, action: string) => void;
  onReorderFields: (orderedIds: string[]) => void;
  onResizeColumn: (fieldId: string, width: number) => void;
  onReorderRecords: (orderedIds: string[]) => void;
  reorderable: boolean;
}

type CellKey = { recordId: string; fieldId: string };
/** A cell range (anchor = where the selection started, focus = the cell it extends to) or a range of whole rows. */
type GridSelection = { kind: "cells"; anchor: CellKey; focus: CellKey } | { kind: "rows"; anchor: string; focus: string };
type GridContextMenu = { x: number; y: number };

interface GridInteractions {
  selection: GridSelection | null;
  range: CellRange | null;
  rowIndex: Map<string, number>;
  cellMouseDown: (event: React.MouseEvent, key: CellKey) => void;
  cellMouseEnter: (event: React.MouseEvent, key: CellKey) => void;
  cellFocus: (key: CellKey) => void;
  rowMouseDown: (event: React.MouseEvent, recordId: string) => void;
  openMenu: (event: React.MouseEvent) => void;
  /** Sub-task tree: collapsed parents, toggling one, adding a sub-task; `indent` when the view shows any hierarchy. */
  tree: { collapsed: ReadonlySet<string>; toggle: (id: string) => void; addSubtask: (parentId: string) => void; indent: boolean };
  /** Values a new row needs to land in a group (grouped views); `{}` otherwise. */
  groupData: (groupKey: string | undefined, sample: RecordRow | undefined) => Record<string, unknown>;
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

  const visibleFields = useMemo(() => orderVisibleFields(fields, columnOrder, hiddenFieldIds), [fields, columnOrder, hiddenFieldIds]);
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const [contextMenu, setContextMenu] = useState<GridContextMenu | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Width of the grid's visible area; on a phone frozen columns must leave room to see the others. */
  const [viewWidth, setViewWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setViewWidth(el.clientWidth));
    ro.observe(el);
    setViewWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const stop = () => {
      dragRef.current = false;
      setDragging(false);
    };
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

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

  // On narrow screens (phones) the frozen columns together take at most about half of the view and
  // no column is wider than the view, so the other fields stay reachable by scrolling sideways.
  const narrow = viewWidth > 0 && viewWidth < 768;
  const frozenIds = new Set(visibleFields.slice(0, frozenCount).map((f) => f.id));
  const frozenCap = Math.max(120, Math.floor(((viewWidth - 36) * 0.55) / Math.max(1, frozenIds.size)));
  // Phones: rows grow to fit, so a long task name wraps inside its narrower column instead of being cut.
  const rowHeight = narrow ? "auto" : props.rowHeight;
  function widthOf(field: FieldRow) {
    const w = columnWidths[field.id] ?? (field.isPrimary ? PRIMARY_WIDTH : DEFAULT_WIDTH);
    if (!narrow) return w;
    return Math.min(w, frozenIds.has(field.id) ? frozenCap : Math.max(120, viewWidth - 72));
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

  // Sub-tasks sit under their parent (indented); collapsed parents hide theirs.
  const flatTree = groups ? [] : buildTaskTree(props.reorderable ? orderedFlatRecords : flatRecords, collapsedTasks);
  const groupTrees = new Map((groups ?? []).map((group) => [group.key, buildTaskTree(group.records, collapsedTasks)]));
  const hasHierarchy = groups ? [...groupTrees.values()].some((rows) => rows.some((r) => r.depth > 0 || r.childCount > 0)) : flatTree.some((r) => r.depth > 0 || r.childCount > 0);
  // Rows in the order they are on screen (rows of collapsed groups / parents are not part of any range).
  const displayRows = groups
    ? groups.flatMap((group) => (collapsedGroups.has(group.key) ? [] : (groupTrees.get(group.key) ?? []).map((r) => r.record)))
    : flatTree.map((r) => r.record);
  // The group each on-screen row is shown in (a task with several assignees can sit in several groups).
  const displayGroupKeys: (string | undefined)[] = groups
    ? groups.flatMap((group) => (collapsedGroups.has(group.key) ? [] : (groupTrees.get(group.key) ?? []).map(() => group.key)))
    : displayRows.map(() => undefined);
  const rowIndex = new Map(displayRows.map((record, index) => [record.id, index]));
  const groupField = props.groupFieldId ? fields.find((f) => f.id === props.groupFieldId) : undefined;

  /** What a new row inserted in a group starts with, so it shows in that same group. */
  function groupData(groupKey: string | undefined, sample: RecordRow | undefined): Record<string, unknown> {
    if (!groupField || groupKey === undefined) return {};
    const value = sample ? getCellValue(sample, groupField, fields) : undefined;
    return groupFieldPatch(groupField, groupKey, value) ?? {};
  }

  /**
   * New rows next to `anchor` stay at its level: next to a sub-task they become sub-tasks of the same
   * parent (and are shown with it whatever the grouping); next to a top-level task they take its group.
   */
  function insertData(anchor: RecordRow, groupKey: string | undefined): Record<string, unknown> {
    const parent = Array.isArray(anchor.data.sys_parent) ? (anchor.data.sys_parent as string[]) : [];
    return parent.length ? { sys_parent: parent.slice(0, 1) } : groupData(groupKey, anchor);
  }
  const colIndex = new Map(visibleFields.map((field, index) => [field.id, index]));

  function rangeOf(sel: GridSelection | null): CellRange | null {
    if (!sel) return null;
    if (sel.kind === "rows") {
      const a = rowIndex.get(sel.anchor);
      const b = rowIndex.get(sel.focus);
      if (a === undefined || b === undefined || !visibleFields.length) return null;
      return { top: Math.min(a, b), bottom: Math.max(a, b), left: 0, right: visibleFields.length - 1 };
    }
    const ar = rowIndex.get(sel.anchor.recordId);
    const fr = rowIndex.get(sel.focus.recordId);
    const ac = colIndex.get(sel.anchor.fieldId);
    const fc = colIndex.get(sel.focus.fieldId);
    if (ar === undefined || fr === undefined || ac === undefined || fc === undefined) return null;
    return normalizeRange({ row: ar, col: ac }, { row: fr, col: fc });
  }
  const range = rangeOf(selection);

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

  const pasteContext: PasteTargetContext = {
    memberIds: new Set(props.members.map((member) => member.id)),
    linkIds: Object.fromEntries(Object.entries(props.linkTargets).map(([fieldId, target]) => [fieldId, new Set(target.records.map((record) => record.id))])),
    okrIds: new Set([...(props.okrOptions?.objectives ?? []).map((o) => o.id), ...(props.okrOptions?.keyResults ?? []).map((k) => k.id)]),
  };

  const textLookup: TextLookup = {
    idForLabel(field, label) {
      const same = (a: string) => a.trim().toLocaleLowerCase() === label.trim().toLocaleLowerCase();
      if (field.type === "person" || field.type === "people") return props.members.find((member) => same(member.name))?.id ?? null;
      if (field.type === "link") return props.linkTargets[field.id]?.records.find((record) => same(record.label))?.id ?? null;
      if (field.type === "okr_objective") return props.okrOptions?.objectives.find((o) => same(o.title))?.id ?? null;
      if (field.type === "okr_key_result") return props.okrOptions?.keyResults.find((k) => same(k.title))?.id ?? null;
      if (field.type === "okr_target") {
        for (const o of parseFieldConfig(field.config).objectives ?? []) {
          if (same(o.title)) return `obj:${o.id}`;
          const kr = o.keyResults.find((k) => same(`${o.title} › ${k.title}`) || same(k.title));
          if (kr) return `kr:${kr.id}`;
        }
      }
      return null;
    },
  };

  /** The typed copy, if the system clipboard still holds exactly what we copied. */
  function typedCopyFor(text: string): GridClipboardPayload | null {
    const copy = getGridClipboard();
    return copy && normalizeClipboardText(copy.text) === normalizeClipboardText(text) ? copy : null;
  }

  function payloadForSelection(sel: GridSelection | null): GridClipboardPayload | null {
    const r = rangeOf(sel);
    if (!sel || !r) return null;
    const rows = displayRows.slice(r.top, r.bottom + 1);
    const cols = visibleFields.slice(r.left, r.right + 1);
    const values = rows.map((record) => cols.map((field) => getCellValue(record, field, fields)));
    const display = values.map((row) => row.map((value, index) => displayClipboardValue(cols[index], value)));
    return createClipboardPayload(sel.kind, cols, values, display);
  }

  async function copySelection(sel: GridSelection | null, event?: ClipboardEvent) {
    const payload = payloadForSelection(sel);
    if (!payload) return;
    setGridClipboard(payload);
    if (event?.clipboardData) event.clipboardData.setData("text/plain", payload.text);
    else {
      try {
        await navigator.clipboard.writeText(payload.text);
      } catch {
        // The typed in-app clipboard remains available even if the browser denies system clipboard access.
      }
    }
    const cells = payload.rows.length * payload.columns.length;
    toast.success(payload.kind === "rows" ? t("grid.rowsCopied", { n: payload.rows.length }) : cells === 1 ? t("grid.cellCopied") : t("grid.cellsCopied", { n: cells }));
  }

  /** Converts one copied cell into the target field and drops values the target cannot accept. */
  function convertCell(field: FieldRow, source: { payload: GridClipboardPayload; row: number; col: number } | { text: string }): ClipboardValueResult {
    if (!isGridFieldPasteable(field)) return { ok: false };
    const result =
      "payload" in source
        ? clipboardEntryToField(source.payload.columns[source.col], source.payload.rows[source.row]?.[source.col], field)
        : clipboardTextToField(source.text, field, textLookup);
    return result.ok ? sanitizeForTarget(field, result.value, pasteContext) : result;
  }

  async function writeChanges(updates: Map<string, Record<string, unknown>>, creates: Record<string, unknown>[], cells: number, skipped: number) {
    if (!updates.size && !creates.length) {
      toast.error(t("grid.pasteIncompatible"));
      return;
    }
    const result = await props.onBulkChange({ updates: [...updates].map(([recordId, patch]) => ({ recordId, patch })), creates });
    if (result.updated || result.created) {
      toast.success(result.created ? t("grid.pastedWithNew", { n: cells, created: result.created }) : t("grid.pasted", { n: cells }));
    }
    if (skipped) toast.info(t("grid.pasteSkipped", { n: skipped }));
  }

  async function pasteInto(sel: GridSelection | null, payload: GridClipboardPayload | null, text: string, mode: "overwrite" | "new") {
    const target = rangeOf(sel);
    if (mode === "overwrite" && (!sel || !target)) return;
    const matrix = payload ? null : parseTsv(text);
    const srcRows = payload ? payload.rows.length : matrix!.length;
    const srcCols = payload ? payload.columns.length : Math.max(0, ...matrix!.map((row) => row.length));
    if (!srcRows || !srcCols) return;
    if (srcRows > MAX_PASTE_ROWS) return void toast.error(t("grid.pasteTooMany", { max: MAX_PASTE_ROWS }));

    const updates = new Map<string, Record<string, unknown>>();
    const creates: Record<string, unknown>[] = [];
    let cells = 0;
    let skipped = 0;
    const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && !v.length);
    const put = (rowIdx: number, field: FieldRow, result: ClipboardValueResult, sourceValue: unknown) => {
      if (!result.ok) {
        if (!isEmpty(sourceValue)) skipped++;
        return;
      }
      let patch: Record<string, unknown>;
      if (rowIdx < displayRows.length) {
        const id = displayRows[rowIdx].id;
        patch = updates.get(id) ?? {};
        updates.set(id, patch);
      } else {
        const n = rowIdx - displayRows.length;
        patch = creates[n] ?? (creates[n] = {});
      }
      patch[field.id] = result.value;
      cells++;
    };
    const firstRow = mode === "new" || !target ? displayRows.length : target.top;

    if (payload?.kind === "rows") {
      // Whole rows: fill fields by identity (same field, same built-in column, or same custom column name).
      payload.rows.forEach((_, i) => {
        for (const field of fields) {
          const col = matchColumn(payload.columns, field);
          if (col < 0) continue;
          put(firstRow + i, field, convertCell(field, { payload, row: i, col }), payload.rows[i][col]);
        }
      });
    } else {
      // A block of cells pastes by position, starting at the selected cell (or the first column of selected rows).
      const left = target && sel?.kind === "cells" ? target.left : 0;
      const area: CellRange =
        mode === "new" || !target
          ? { top: firstRow, bottom: firstRow + srcRows - 1, left, right: left + srcCols - 1 }
          : sel?.kind === "rows"
            ? { top: target.top, bottom: target.top, left: 0, right: 0 }
            : target;
      for (const cell of planPaste({ rows: srcRows, cols: srcCols }, area, { rows: displayRows.length, cols: visibleFields.length })) {
        const field = visibleFields[cell.col];
        const source = payload ? { payload, row: cell.srcRow, col: cell.srcCol } : { text: matrix![cell.srcRow]?.[cell.srcCol] ?? "" };
        put(cell.row, field, convertCell(field, source), payload ? payload.rows[cell.srcRow]?.[cell.srcCol] : matrix![cell.srcRow]?.[cell.srcCol]);
      }
    }
    // A new row needs at least one value; an all-empty one would only add an "Untitled task".
    const newRows = creates.filter((patch) => patch && Object.keys(patch).length);
    if (mode === "overwrite" && target && (updates.size > rangeRows(target) || newRows.length)) {
      if (!confirm(t("grid.pasteConfirm", { rows: updates.size, created: newRows.length }))) return;
    }
    await writeChanges(updates, newRows, cells, skipped);
  }

  async function readClipboardText(): Promise<string> {
    try {
      return await navigator.clipboard.readText();
    } catch {
      // Browser clipboard permission is optional; an in-app copy still works.
      return getGridClipboard()?.text ?? "";
    }
  }

  async function pasteFromMenu(mode: "overwrite" | "new") {
    const text = await readClipboardText();
    await pasteInto(selection, typedCopyFor(text), text, mode);
  }

  /** Ctrl+D: copy the top row of the selection into the rows below it (or the row above into one row). */
  async function fillDown() {
    if (!range) return;
    const plan = planFillDown(range);
    if (!plan) return;
    const source = displayRows[plan.sourceRow];
    const updates = new Map<string, Record<string, unknown>>();
    let cells = 0;
    for (let col = range.left; col <= range.right; col++) {
      const field = visibleFields[col];
      if (!isGridFieldPasteable(field)) continue;
      const value = sanitizeForTarget(field, getCellValue(source, field, fields), pasteContext);
      if (!value.ok) continue;
      for (const row of plan.rows) {
        const id = displayRows[row].id;
        updates.set(id, { ...updates.get(id), [field.id]: value.value });
        cells++;
      }
    }
    await writeChanges(updates, [], cells, 0);
  }

  function textSelectionInside(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return false;
    try {
      return target.selectionStart !== null && target.selectionEnd !== null && target.selectionStart !== target.selectionEnd;
    } catch {
      return false; // inputs such as type=number do not expose a selection
    }
  }

  function isTextEditor(target: EventTarget | null): boolean {
    if (target instanceof HTMLTextAreaElement) return true;
    if (target instanceof HTMLInputElement) return !["checkbox", "radio", "button", "date", "datetime-local", "range"].includes(target.type);
    return target instanceof HTMLElement && target.isContentEditable;
  }

  const multiCell = !!range && (selection?.kind === "rows" || rangeRows(range) > 1 || rangeCols(range) > 1);

  function handleCopy(event: ClipboardEvent) {
    if (!selection || (!multiCell && textSelectionInside(event.target))) return;
    event.preventDefault();
    void copySelection(selection, event);
  }

  function handlePaste(event: ClipboardEvent) {
    if (!selection) return;
    const text = event.clipboardData?.getData("text/plain") ?? "";
    const typed = typedCopyFor(text);
    const block = typed ? typed.rows.length > 1 || typed.columns.length > 1 || typed.kind === "rows" : /[\t\n]/.test(normalizeClipboardText(text));
    // A single value typed into the cell being edited is ordinary text input.
    if (!block && !multiCell && isTextEditor(event.target)) return;
    event.preventDefault();
    void pasteInto(selection, typed, text, "overwrite");
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      setContextMenu(null);
      if (multiCell && selection?.kind === "cells") setSelection({ kind: "cells", anchor: selection.focus, focus: selection.focus });
      return;
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "d" && selection) {
      event.preventDefault(); // also keeps the browser's "bookmark page" shortcut out of the grid
      (document.activeElement as HTMLElement | null)?.blur?.();
      void fillDown();
    }
  }

  // Clipboard and shortcut events are handled at document level: a select / people / date cell edits in a
  // popover rendered outside the grid, and Ctrl+C / V / D must still reach the grid while it is open.
  // They only apply while the grid is "active" (the last click was in it or in such a popover).
  const handlersRef = useRef({ handleCopy, handlePaste, handleKeyDown });
  useEffect(() => {
    handlersRef.current = { handleCopy, handlePaste, handleKeyDown };
  });
  const gridActiveRef = useRef(false);
  useEffect(() => {
    const inPopover = (target: EventTarget | null) => target instanceof Element && !!target.closest("[data-radix-popper-content-wrapper]");
    const inScope = (target: EventTarget | null) =>
      (target instanceof Node && !!containerRef.current?.contains(target)) || (gridActiveRef.current && (target === document.body || inPopover(target)));
    const onMouseDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) gridActiveRef.current = true;
      else if (!inPopover(event.target)) gridActiveRef.current = false;
    };
    const onCopy = (event: ClipboardEvent) => inScope(event.target) && handlersRef.current.handleCopy(event);
    const onPaste = (event: ClipboardEvent) => inScope(event.target) && handlersRef.current.handlePaste(event);
    const onKeyDown = (event: KeyboardEvent) => inScope(event.target) && handlersRef.current.handleKeyDown(event);
    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  /** Leave the cell editor and hand keyboard / clipboard events to the grid while a range is selected. */
  function focusGrid() {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== containerRef.current && containerRef.current?.contains(active)) active.blur();
    window.getSelection()?.removeAllRanges();
    containerRef.current?.focus({ preventScroll: true });
  }

  const interactions: GridInteractions = {
    selection,
    range,
    rowIndex,
    cellMouseDown(event, key) {
      const row = rowIndex.get(key.recordId);
      const col = colIndex.get(key.fieldId);
      if (event.button === 2) {
        // Right-click inside the current selection keeps it, so the menu acts on the whole range.
        if (range && row !== undefined && col !== undefined && inRange(range, row, col)) return;
        setSelection({ kind: "cells", anchor: key, focus: key });
        return;
      }
      if (event.button !== 0) return;
      if (event.shiftKey && selection?.kind === "cells") {
        event.preventDefault();
        setSelection({ ...selection, focus: key });
        focusGrid();
        return;
      }
      setSelection({ kind: "cells", anchor: key, focus: key });
      dragRef.current = true;
    },
    cellMouseEnter(event, key) {
      if (!dragRef.current || !(event.buttons & 1) || selection?.kind !== "cells") return;
      if (selection.focus.recordId === key.recordId && selection.focus.fieldId === key.fieldId) return;
      setSelection({ ...selection, focus: key });
      if (!dragging) setDragging(true);
      focusGrid();
    },
    cellFocus(key) {
      // Tabbing into a cell selects it; a focus that lands inside the current range (e.g. a click) keeps the range.
      const row = rowIndex.get(key.recordId);
      const col = colIndex.get(key.fieldId);
      if (multiCell && range && row !== undefined && col !== undefined && inRange(range, row, col)) return;
      setSelection({ kind: "cells", anchor: key, focus: key });
    },
    rowMouseDown(event, recordId) {
      if (event.button === 2 && range && selection?.kind === "rows") {
        const row = rowIndex.get(recordId);
        if (row !== undefined && row >= range.top && row <= range.bottom) return;
      }
      if (event.button === 0 && event.shiftKey && selection?.kind === "rows") {
        event.preventDefault();
        setSelection({ ...selection, focus: recordId });
      } else setSelection({ kind: "rows", anchor: recordId, focus: recordId });
      focusGrid();
    },
    openMenu(event) {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    },
    tree: {
      collapsed: collapsedTasks,
      indent: hasHierarchy,
      toggle: (id) =>
        setCollapsedTasks((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        }),
      addSubtask: (parentId) => {
        setCollapsedTasks((prev) => {
          if (!prev.has(parentId)) return prev;
          const next = new Set(prev);
          next.delete(parentId);
          return next;
        });
        // Sub-tasks are always shown right under their parent (grouping follows the parent), so they
        // need no group value of their own.
        props.onAddRecord({ sys_parent: [parentId] });
      },
    },
    groupData,
  };

  const canPaste = visibleFields.some(isGridFieldPasteable);

  const { focusRecordId, onFocused } = props;
  const focusVisible = !!focusRecordId && rowIndex.has(focusRecordId);
  useEffect(() => {
    if (!focusRecordId || !focusVisible) return;
    const row = containerRef.current?.querySelector(`[data-record-id="${focusRecordId}"]`);
    const input = row?.querySelector<HTMLInputElement | HTMLTextAreaElement>('[data-field-id="sys_title"] input, [data-field-id="sys_title"] textarea');
    row?.scrollIntoView({ block: "center" });
    if (input) {
      input.focus();
      input.select();
    }
    onFocused?.();
  }, [focusRecordId, focusVisible, onFocused]);

  /** Tasks a move / duplicate acts on: the ticked rows, else the rows of the current selection. */
  function transferIds(): string[] {
    if (props.selectedIds.size) return [...props.selectedIds];
    return range ? displayRows.slice(range.top, range.bottom + 1).map((record) => record.id) : [];
  }

  async function insertRows(position: "above" | "below", count: number) {
    if (!range || !props.onInsertRows) return;
    const at = position === "above" ? range.top : range.bottom;
    const anchor = displayRows[at];
    if (!anchor) return;
    await props.onInsertRows(anchor.id, position, count, insertData(anchor, displayGroupKeys[at]));
  }

  async function deleteRows() {
    const ids = transferIds();
    if (!ids.length || !props.onDeleteRecords) return;
    const gone = new Set(ids);
    const orphans = flatRecords.filter((r) => !gone.has(r.id) && ((r.data.sys_parent as string[] | undefined) ?? []).some((p) => gone.has(p))).length;
    const message = orphans ? t("grid.deleteRowsWithChildren", { n: ids.length, c: orphans }) : t("grid.deleteRowsConfirm", { n: ids.length });
    if (!confirm(message)) return;
    setSelection(null);
    await props.onDeleteRecords(ids);
  }

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className={cn("flex-1 overflow-auto thin-scroll outline-none", dragging && "select-none")}
      data-testid="grid-view"
    >
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
              <GroupSection
                key={group.key}
                group={group}
                open={!collapsedGroups.has(group.key)}
                onToggle={() =>
                  setCollapsedGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.key)) next.delete(group.key);
                    else next.add(group.key);
                    return next;
                  })
                }
                {...props}
                rowHeight={rowHeight}
                treeRows={groupTrees.get(group.key) ?? []}
                visibleFields={visibleFields}
                widthOf={widthOf}
                interactions={interactions}
              />
            ))
          ) : props.reorderable ? (
            <SortableContext items={flatTree.map((r) => r.record.id)} strategy={verticalListSortingStrategy}>
              {flatTree.map((r) => (
                <Row key={r.record.id} record={r.record} depth={r.depth} childCount={r.childCount} {...props} rowHeight={rowHeight} visibleFields={visibleFields} widthOf={widthOf} interactions={interactions} />
              ))}
            </SortableContext>
          ) : (
            flatTree.map((r) => <Row key={r.record.id} record={r.record} depth={r.depth} childCount={r.childCount} {...props} rowHeight={rowHeight} visibleFields={visibleFields} widthOf={widthOf} interactions={interactions} />)
          )}
        </DndContext>
      </div>
      <button
        onClick={() => props.onAddRecord()}
        className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-900 w-full text-left border-b border-neutral-100 dark:border-neutral-900"
      >
        <Plus size={14} /> {t("grid.addTask")}
      </button>
      {contextMenu && selection ? (
        <GridClipboardMenu
          menu={contextMenu}
          rowsSelected={selection.kind === "rows"}
          multi={multiCell}
          canPaste={canPaste}
          canFillDown={!!range && !!planFillDown(range)}
          close={() => setContextMenu(null)}
          copy={() => void copySelection(selection)}
          copyRows={() => {
            if (!range) return;
            const rowsSel: GridSelection = { kind: "rows", anchor: displayRows[range.top].id, focus: displayRows[range.bottom].id };
            setSelection(rowsSel);
            void copySelection(rowsSel);
          }}
          paste={() => void pasteFromMenu("overwrite")}
          pasteAsNew={() => void pasteFromMenu("new")}
          fillDown={() => void fillDown()}
          transfer={props.onTransferTasks ? (mode) => props.onTransferTasks!(transferIds(), mode) : undefined}
          addSubtask={range && range.top === range.bottom ? () => interactions.tree.addSubtask(displayRows[range.top].id) : undefined}
          defaultInsertCount={range ? rangeRows(range) : 1}
          insertRows={props.onInsertRows && range ? (position, count) => void insertRows(position, count) : undefined}
          deleteCount={props.onDeleteRecords ? transferIds().length : 0}
          deleteRows={() => void deleteRows()}
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

function Row({
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
                  className={cn("absolute right-1 z-[7] flex h-6 w-6 items-center justify-center rounded border border-neutral-200 bg-white text-neutral-500 shadow-sm hover:text-indigo-600 dark:border-neutral-700 dark:bg-neutral-900", autoFit ? "top-1.5" : "top-1/2 -translate-y-1/2", revealOn.row)}
                  title={t("grid.addSubtask")}
                  aria-label={t("grid.addSubtask")}
                  data-testid="add-subtask"
                >
                  <ListTree size={13} />
                </button>
              )}
              <div className={cn("flex-1 overflow-hidden", autoFit ? "" : "h-full", field.isPrimary && autoFit && "pr-7", field.isPrimary && childCount > 0 && "[&_input]:font-semibold [&_textarea]:font-semibold", field.isPrimary && depth > 0 && "[&_input]:text-neutral-700 [&_textarea]:text-neutral-700 dark:[&_input]:text-neutral-300 dark:[&_textarea]:text-neutral-300")}>
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
  rowsSelected,
  multi,
  canPaste,
  canFillDown,
  close,
  copy,
  copyRows,
  paste,
  pasteAsNew,
  fillDown,
  transfer,
  addSubtask,
  defaultInsertCount,
  insertRows,
  deleteCount,
  deleteRows,
}: {
  menu: GridContextMenu;
  rowsSelected: boolean;
  multi: boolean;
  canPaste: boolean;
  canFillDown: boolean;
  close: () => void;
  copy: () => void;
  copyRows: () => void;
  paste: () => void;
  pasteAsNew: () => void;
  fillDown: () => void;
  transfer?: (mode: "move" | "duplicate") => void;
  addSubtask?: () => void;
  defaultInsertCount: number;
  insertRows?: (position: "above" | "below", count: number) => void;
  deleteCount: number;
  deleteRows: () => void;
}) {
  const { t } = useT();
  const [insertCount, setInsertCount] = useState(String(Math.min(Math.max(defaultInsertCount, 1), MAX_INSERT_ROWS)));
  const count = Math.min(Math.max(Math.floor(Number(insertCount)) || 1, 1), MAX_INSERT_ROWS);
  const left = typeof window === "undefined" ? menu.x : Math.min(menu.x, window.innerWidth - 250);
  const top = typeof window === "undefined" ? menu.y : Math.max(8, Math.min(menu.y, window.innerHeight - 460));
  const action = (handler: () => void) => () => {
    close();
    handler();
  };
  const item = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-800";
  const kbd = "ml-auto text-[10px] text-neutral-400";
  return (
    <div className="fixed inset-0 z-[80]" onMouseDown={close} onContextMenu={(event) => { event.preventDefault(); close(); }}>
      <div role="menu" aria-label={t("grid.clipboardMenu")} className="fixed w-60 max-h-[calc(100vh-16px)] overflow-y-auto thin-scroll rounded-md border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-800 dark:bg-neutral-900" style={{ left, top }} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" className={item} onClick={action(copy)}>
          <Copy size={14} />
          {rowsSelected ? t("grid.copyRows") : multi ? t("grid.copySelection") : t("grid.copyCell")}
          <span className={kbd}>Ctrl+C</span>
        </button>
        <button type="button" role="menuitem" className={item} disabled={!canPaste} onClick={action(paste)}>
          <ClipboardPaste size={14} />
          {t("grid.paste")}
          <span className={kbd}>Ctrl+V</span>
        </button>
        <button type="button" role="menuitem" className={item} disabled={!canFillDown} onClick={action(fillDown)}>
          <ArrowDownToLine size={14} />
          {t("grid.fillDown")}
          <span className={kbd}>Ctrl+D</span>
        </button>
        <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />
        {!rowsSelected ? (
          <button type="button" role="menuitem" className={item} onClick={action(copyRows)}>
            <Rows3 size={14} />
            {t("grid.copyRows")}
          </button>
        ) : null}
        <button type="button" role="menuitem" className={item} disabled={!canPaste} onClick={action(pasteAsNew)}>
          <Plus size={14} />
          {t("grid.pasteAsNew")}
        </button>
        {insertRows ? (
          <>
            <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />
            <div className="flex items-center gap-1.5 px-2 py-1 text-sm text-neutral-700 dark:text-neutral-200" data-testid="grid-insert-rows">
              <Plus size={14} className="shrink-0" />
              {t("grid.insertRows")}
              <input
                type="number"
                min={1}
                max={MAX_INSERT_ROWS}
                value={insertCount}
                onChange={(event) => setInsertCount(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") action(() => insertRows("below", count))();
                  if (event.key === "Escape") close();
                }}
                className="h-6 w-12 rounded border border-neutral-200 bg-white px-1 text-center text-sm dark:border-neutral-700 dark:bg-neutral-950"
                aria-label={t("grid.insertRowsCount")}
                data-testid="grid-insert-count"
              />
              <span className="text-neutral-500">{t("grid.rowsWord")}</span>
            </div>
            <div className="flex gap-1 px-2 pb-1">
              <button type="button" role="menuitem" className={cn(item, "justify-center border border-neutral-200 dark:border-neutral-700")} title={t("grid.insertAboveTitle", { n: count })} onClick={action(() => insertRows("above", count))} data-testid="grid-insert-above">
                <ArrowUp size={13} />
                {t("grid.insertAbove")}
              </button>
              <button type="button" role="menuitem" className={cn(item, "justify-center border border-neutral-200 dark:border-neutral-700")} title={t("grid.insertBelowTitle", { n: count })} onClick={action(() => insertRows("below", count))} data-testid="grid-insert-below">
                <ArrowDown size={13} />
                {t("grid.insertBelow")}
              </button>
            </div>
          </>
        ) : null}
        {addSubtask ? (
          <>
            <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />
            <button type="button" role="menuitem" className={item} onClick={action(addSubtask)}>
              <ListTree size={14} />
              {t("grid.addSubtask")}
            </button>
          </>
        ) : null}
        {transfer ? (
          <>
            <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />
            <button type="button" role="menuitem" className={item} onClick={action(() => transfer("move"))}>
              <ArrowRightLeft size={14} />
              {t("tt.moveMenu")}
            </button>
            <button type="button" role="menuitem" className={item} onClick={action(() => transfer("duplicate"))}>
              <CopyPlus size={14} />
              {t("tt.duplicateMenu")}
            </button>
          </>
        ) : null}
        {deleteCount > 0 ? (
          <>
            <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />
            <button type="button" role="menuitem" className={cn(item, "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40")} onClick={action(deleteRows)} data-testid="grid-delete-rows">
              <Trash2 size={14} />
              {t("grid.deleteRows", { n: deleteCount })}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export { CellDisplayValue };
