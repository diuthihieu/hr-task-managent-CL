import {
  DATE_LIKE_TYPES,
  NUMERIC_LIKE_TYPES,
  SELECT_MULTI_TYPES,
  SELECT_SINGLE_TYPES,
  TEXT_LIKE_TYPES,
  getFieldType,
  migrateFieldValue,
  parseFieldConfig,
  resolveOkrTarget,
} from "./field-types";
import type { FieldRow } from "@/types";

/** One copied column: enough of the source field to convert its values into another field or project. */
export interface GridClipboardColumn {
  fieldId: string;
  fieldType: string;
  fieldConfig: string | null;
  fieldName: string;
  projectId: string;
}

/**
 * A rectangular copy from the task grid. `cells` came from a cell range and pastes by position;
 * `rows` came from whole rows and pastes by matching fields, so column order and views do not matter.
 */
export interface GridClipboardPayload {
  kind: "cells" | "rows";
  text: string;
  columns: GridClipboardColumn[];
  rows: unknown[][];
}

export type ClipboardValueResult = { ok: true; value: unknown } | { ok: false };

/** Values that only make sense inside one project/workspace, checked against what the target grid offers. */
export interface PasteTargetContext {
  memberIds: ReadonlySet<string>;
  /** Selectable records per link field id. */
  linkIds: Readonly<Record<string, ReadonlySet<string>>>;
  okrIds: ReadonlySet<string>;
}

export interface TextLookup {
  /** Resolves a display label (member name, linked task title, objective title) to an id for the field. */
  idForLabel: (field: FieldRow, label: string) => string | null;
}

const SELECT_TYPES = [...SELECT_SINGLE_TYPES, ...SELECT_MULTI_TYPES];

const cloneValue = (value: unknown): unknown => {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as unknown;
};

export function isGridFieldPasteable(field: FieldRow): boolean {
  return !field.readOnly && getFieldType(field.type).editable;
}

export function columnOf(field: FieldRow): GridClipboardColumn {
  return { fieldId: field.id, fieldType: field.type, fieldConfig: field.config, fieldName: field.name, projectId: field.projectId };
}

export function createClipboardPayload(kind: GridClipboardPayload["kind"], fields: FieldRow[], rows: unknown[][], displayRows: string[][]): GridClipboardPayload {
  return { kind, text: toTsv(displayRows), columns: fields.map(columnOf), rows: rows.map((row) => row.map(cloneValue)) };
}

const sameField = (column: GridClipboardColumn, target: FieldRow) => column.fieldId === target.id && column.projectId === target.projectId;

function selectIdsForTarget(column: GridClipboardColumn, value: unknown, target: FieldRow): ClipboardValueResult {
  const sourceConfig = parseFieldConfig(column.fieldConfig);
  const targetConfig = parseFieldConfig(target.config);
  const sourceIds = Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)];
  const targetIds: string[] = [];
  for (const sourceId of sourceIds) {
    const label = sourceConfig.options?.find((option) => option.id === sourceId)?.label;
    if (!label) return { ok: false };
    const targetOption = targetConfig.options?.find((option) => option.label.trim().toLocaleLowerCase() === label.trim().toLocaleLowerCase());
    if (!targetOption) return { ok: false };
    targetIds.push(targetOption.id);
  }
  return SELECT_MULTI_TYPES.includes(target.type) ? { ok: true, value: targetIds } : { ok: true, value: targetIds[0] ?? null };
}

/**
 * Convert one copied value into the target field. Values are kept as-is only for the very same field of the
 * same project; anything else (another column, or the same built-in column of another project, whose
 * categories and tasks are different) goes through a conversion with a defined meaning.
 */
export function clipboardEntryToField(column: GridClipboardColumn, value: unknown, target: FieldRow): ClipboardValueResult {
  if (!isGridFieldPasteable(target)) return { ok: false };
  if (sameField(column, target)) return { ok: true, value: cloneValue(value) };

  const sourceSelect = SELECT_TYPES.includes(column.fieldType);
  const targetSelect = SELECT_TYPES.includes(target.type);
  if (sourceSelect && targetSelect) return selectIdsForTarget(column, value, target);
  if (column.fieldType === target.type) return { ok: true, value: cloneValue(value) };

  const compatible =
    (TEXT_LIKE_TYPES.includes(column.fieldType) && TEXT_LIKE_TYPES.includes(target.type)) ||
    (NUMERIC_LIKE_TYPES.includes(column.fieldType) && NUMERIC_LIKE_TYPES.includes(target.type)) ||
    (DATE_LIKE_TYPES.includes(column.fieldType) && (DATE_LIKE_TYPES.includes(target.type) || TEXT_LIKE_TYPES.includes(target.type))) ||
    (sourceSelect && TEXT_LIKE_TYPES.includes(target.type)) ||
    (["checkbox", ...TEXT_LIKE_TYPES, ...NUMERIC_LIKE_TYPES].includes(column.fieldType) &&
      ["checkbox", ...TEXT_LIKE_TYPES, ...NUMERIC_LIKE_TYPES].includes(target.type)) ||
    (["person", "people"].includes(column.fieldType) && ["person", "people"].includes(target.type)) ||
    (column.fieldType === "attachment" && TEXT_LIKE_TYPES.includes(target.type));

  if (!compatible) return { ok: false };
  return { ok: true, value: migrateFieldValue(column.fieldType, target.type, cloneValue(value), parseFieldConfig(column.fieldConfig)) };
}

/**
 * The copied column that feeds a target field in a whole-row paste: the same field, else the same built-in
 * column of another project (they share ids), else a custom column with the same name.
 */
export function matchColumn(columns: GridClipboardColumn[], target: FieldRow): number {
  const exact = columns.findIndex((column) => sameField(column, target));
  if (exact >= 0) return exact;
  if (target.system) return columns.findIndex((column) => column.fieldId === target.id);
  const name = target.name.trim().toLocaleLowerCase();
  return columns.findIndex((column) => !column.fieldId.startsWith("sys_") && column.fieldName.trim().toLocaleLowerCase() === name);
}

/**
 * Drop references the target cannot accept (members, linked tasks, objectives and options of another
 * project or workspace), so one foreign id never makes the server reject the whole row.
 * Returns `{ ok: false }` when nothing usable is left for a value that was not empty.
 */
export function sanitizeForTarget(field: FieldRow, value: unknown, ctx: PasteTargetContext): ClipboardValueResult {
  const keep = (ids: unknown, allowed: ReadonlySet<string> | undefined) => {
    const list = Array.isArray(ids) ? ids.map(String) : ids == null || ids === "" ? [] : [String(ids)];
    const kept = allowed ? list.filter((id) => allowed.has(id)) : [];
    return { list, kept };
  };
  if (SELECT_TYPES.includes(field.type)) {
    const options = new Set((parseFieldConfig(field.config).options ?? []).map((option) => option.id));
    const { list, kept } = keep(value, options);
    if (list.length && !kept.length) return { ok: false };
    // Every task has a status: clearing it is not a valid paste.
    if (field.type === "status" && !kept.length) return { ok: false };
    return { ok: true, value: SELECT_MULTI_TYPES.includes(field.type) ? kept : kept[0] ?? null };
  }
  if (field.type === "person" || field.type === "people") {
    const { list, kept } = keep(value, ctx.memberIds);
    if (list.length && !kept.length) return { ok: false };
    return { ok: true, value: field.type === "people" ? kept : kept[0] ?? null };
  }
  if (field.type === "link") {
    const { list, kept } = keep(value, ctx.linkIds[field.id]);
    if (list.length && !kept.length) return { ok: false };
    const max = parseFieldConfig(field.config).maxLinks;
    return { ok: true, value: max ? kept.slice(-max) : kept };
  }
  if (field.type === "okr_target") {
    if (value == null || value === "") return { ok: true, value: null };
    return resolveOkrTarget(parseFieldConfig(field.config), value) ? { ok: true, value } : { ok: false };
  }
  if (field.type === "okr_objective" || field.type === "okr_key_result") {
    if (value == null || value === "") return { ok: true, value: null };
    return ctx.okrIds.has(String(value)) ? { ok: true, value } : { ok: false };
  }
  if (field.isPrimary && (typeof value !== "string" || !value.trim())) return { ok: false };
  return { ok: true, value };
}

/** Convert plain clipboard text (for example from Excel) to a cell's typed value. */
export function clipboardTextToField(text: string, target: FieldRow, lookup?: TextLookup): ClipboardValueResult {
  if (!isGridFieldPasteable(target)) return { ok: false };
  const raw = text.replace(/\r\n/g, "\n");
  const trimmed = raw.trim();
  if (TEXT_LIKE_TYPES.includes(target.type) || target.type === "barcode") return { ok: true, value: raw };
  if (!trimmed) {
    if (target.type === "multi_select" || target.type === "people" || target.type === "attachment" || target.type === "link") return { ok: true, value: [] };
    return { ok: true, value: null };
  }

  if (NUMERIC_LIKE_TYPES.includes(target.type)) {
    const numeric = Number(trimmed.replace(/[%\s,]/g, ""));
    if (!Number.isFinite(numeric)) return { ok: false };
    const value = target.type === "integer" ? Math.round(numeric) : target.type === "progress" ? Math.max(0, Math.min(100, Math.round(numeric))) : target.type === "rating" ? Math.max(0, Math.min(10, Math.round(numeric))) : numeric;
    return { ok: true, value };
  }
  if (target.type === "checkbox") {
    const normalized = trimmed.toLocaleLowerCase();
    if (["true", "yes", "1", "x", "có"].includes(normalized)) return { ok: true, value: true };
    if (["false", "no", "0", "không"].includes(normalized)) return { ok: true, value: false };
    return { ok: false };
  }
  if (DATE_LIKE_TYPES.includes(target.type)) {
    const date = parseClipboardDate(trimmed);
    if (!date) return { ok: false };
    return { ok: true, value: target.type === "date" ? date.toISOString().slice(0, 10) : date.toISOString() };
  }
  if (SELECT_TYPES.includes(target.type)) {
    const config = parseFieldConfig(target.config);
    const labels = trimmed.split(",").map((label) => label.trim()).filter(Boolean);
    const ids: string[] = [];
    for (const label of labels) {
      const option = config.options?.find((candidate) => candidate.id === label || candidate.label.trim().toLocaleLowerCase() === label.toLocaleLowerCase());
      if (!option) return { ok: false };
      ids.push(option.id);
    }
    return SELECT_MULTI_TYPES.includes(target.type) ? { ok: true, value: ids } : { ok: true, value: ids[0] ?? null };
  }
  if (["person", "people", "link"].includes(target.type) || target.type.startsWith("okr_")) {
    if (!lookup) return { ok: false };
    const labels = target.type.startsWith("okr_") ? [trimmed] : trimmed.split(",").map((label) => label.trim()).filter(Boolean);
    const ids: string[] = [];
    for (const label of labels) {
      const id = lookup.idForLabel(target, label);
      if (!id) return { ok: false };
      ids.push(id);
    }
    return target.type === "people" || target.type === "link" ? { ok: true, value: ids } : { ok: true, value: ids[0] ?? null };
  }
  if (target.type === "team") {
    const team = parseFieldConfig(target.config).teams?.find((candidate) => candidate.id === trimmed || candidate.name.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase());
    return team ? { ok: true, value: team.id } : { ok: false };
  }
  if (target.type === "location") return { ok: true, value: { address: raw } };
  if (target.type === "json") {
    try {
      return { ok: true, value: JSON.parse(trimmed) as unknown };
    } catch {
      return { ok: false };
    }
  }
  return { ok: false };
}

/** Dates as the grid shows them (dd/mm/yyyy), ISO, or anything Date understands - in that order. */
function parseClipboardDate(text: string): Date | null {
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?$/.exec(text);
  if (dmy) {
    const [, d, m, y, hh, mm] = dmy.map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, hh || 0, mm || 0));
    return date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    const date = new Date(`${text}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Tab-separated text the way spreadsheets write it: cells holding tabs, newlines or quotes are quoted. */
export function toTsv(rows: string[][]): string {
  const cell = (value: string) => (/[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return rows.map((row) => row.map(cell).join("\t")).join("\n");
}

/** Parse spreadsheet clipboard text into rows of cells (quoted cells may contain tabs and newlines). */
export function parseTsv(text: string): string[][] {
  const src = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  let atCellStart = true;
  while (i < src.length) {
    const ch = src[i];
    if (atCellStart && ch === '"') {
      const end = findClosingQuote(src, i + 1);
      if (end >= 0 && (end + 1 === src.length || src[end + 1] === "\t" || src[end + 1] === "\n")) {
        cell = src.slice(i + 1, end).replace(/""/g, '"');
        i = end + 1;
        atCellStart = false;
        continue;
      }
    }
    atCellStart = false;
    if (ch === "\t") {
      row.push(cell);
      cell = "";
      atCellStart = true;
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      atCellStart = true;
    } else cell += ch;
    i++;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function findClosingQuote(src: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] !== '"') continue;
    if (src[i + 1] === '"') i++;
    else return i;
  }
  return -1;
}

export const normalizeClipboardText = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
