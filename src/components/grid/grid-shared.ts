// Shared by the grid's pieces: sizes, limits, and the selection / interaction types.
import { type Member, type LinkTarget, type OkrOptions } from "./cell";
import { type RecordGroup, type ConditionalFormatRule } from "@/lib/query-engine";
import type { FieldRow, RecordRow } from "@/types";
import { type CellRange } from "@/lib/grid-selection";

export const ROW_HEIGHTS: Record<string, number> = { short: 32, medium: 40, tall: 64 };
export const DEFAULT_WIDTH = 180;
export const PRIMARY_WIDTH = 220;
/** One paste writes at most this many rows, so a stray clipboard cannot flood a project. */
export const MAX_PASTE_ROWS = 500;
/** "Insert rows" adds at most this many at once (the server enforces the same limit). */
export const MAX_INSERT_ROWS = 50;
/** Indent per sub-task level in the name column (px). */
export const TREE_STEP = 22;

export interface GridBulkChange {
  updates: { recordId: string; patch: Record<string, unknown> }[];
  creates: Record<string, unknown>[];
}

export interface GridViewProps {
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

export type CellKey = { recordId: string; fieldId: string };
/** A cell range (anchor = where the selection started, focus = the cell it extends to) or a range of whole rows. */
export type GridSelection = { kind: "cells"; anchor: CellKey; focus: CellKey } | { kind: "rows"; anchor: string; focus: string };
export type GridContextMenu = { x: number; y: number };

export interface GridInteractions {
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
