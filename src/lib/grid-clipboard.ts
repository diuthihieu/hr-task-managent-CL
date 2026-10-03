import {
  DATE_LIKE_TYPES,
  NUMERIC_LIKE_TYPES,
  SELECT_MULTI_TYPES,
  SELECT_SINGLE_TYPES,
  TEXT_LIKE_TYPES,
  getFieldType,
  migrateFieldValue,
  parseFieldConfig,
} from "./field-types";
import type { FieldRow } from "@/types";

export interface GridClipboardEntry {
  fieldId: string;
  fieldType: string;
  fieldConfig: string | null;
  value: unknown;
}

export type GridClipboardPayload =
  | { kind: "cell"; text: string; entry: GridClipboardEntry }
  | { kind: "row"; text: string; entries: GridClipboardEntry[] };

export type ClipboardValueResult = { ok: true; value: unknown } | { ok: false };

const cloneValue = (value: unknown): unknown => {
  if (value === undefined || value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as unknown;
};

export function isGridFieldPasteable(field: FieldRow): boolean {
  return !field.readOnly && getFieldType(field.type).editable;
}

export function createCellClipboardPayload(field: FieldRow, value: unknown, text: string): GridClipboardPayload {
  return {
    kind: "cell",
    text,
    entry: { fieldId: field.id, fieldType: field.type, fieldConfig: field.config, value: cloneValue(value) },
  };
}

export function createRowClipboardPayload(fields: FieldRow[], values: unknown[], text: string): GridClipboardPayload {
  return {
    kind: "row",
    text,
    entries: fields.map((field, index) => ({
      fieldId: field.id,
      fieldType: field.type,
      fieldConfig: field.config,
      value: cloneValue(values[index]),
    })),
  };
}

function selectIdsForTarget(entry: GridClipboardEntry, target: FieldRow): ClipboardValueResult {
  const sourceConfig = parseFieldConfig(entry.fieldConfig);
  const targetConfig = parseFieldConfig(target.config);
  const sourceIds = Array.isArray(entry.value) ? entry.value.map(String) : entry.value == null ? [] : [String(entry.value)];
  const targetIds: string[] = [];
  for (const sourceId of sourceIds) {
    const label = sourceConfig.options?.find((option) => option.id === sourceId)?.label;
    if (!label) return { ok: false };
    const targetOption = targetConfig.options?.find((option) => option.label.trim().toLocaleLowerCase() === label.trim().toLocaleLowerCase());
    if (!targetOption) return { ok: false };
    targetIds.push(targetOption.id);
  }
  return SELECT_MULTI_TYPES.includes(target.type)
    ? { ok: true, value: targetIds }
    : { ok: true, value: targetIds[0] ?? null };
}

/** Preserve typed values for in-app paste, only converting combinations with a defined safe meaning. */
export function clipboardEntryToField(entry: GridClipboardEntry, target: FieldRow): ClipboardValueResult {
  if (!isGridFieldPasteable(target)) return { ok: false };
  if (entry.fieldId === target.id || entry.fieldType === target.type && ![...SELECT_SINGLE_TYPES, ...SELECT_MULTI_TYPES].includes(target.type)) {
    return { ok: true, value: cloneValue(entry.value) };
  }

  const sourceSelect = [...SELECT_SINGLE_TYPES, ...SELECT_MULTI_TYPES].includes(entry.fieldType);
  const targetSelect = [...SELECT_SINGLE_TYPES, ...SELECT_MULTI_TYPES].includes(target.type);
  if (sourceSelect && targetSelect) return selectIdsForTarget(entry, target);

  const compatible =
    (TEXT_LIKE_TYPES.includes(entry.fieldType) && TEXT_LIKE_TYPES.includes(target.type)) ||
    (NUMERIC_LIKE_TYPES.includes(entry.fieldType) && NUMERIC_LIKE_TYPES.includes(target.type)) ||
    (DATE_LIKE_TYPES.includes(entry.fieldType) && (DATE_LIKE_TYPES.includes(target.type) || TEXT_LIKE_TYPES.includes(target.type))) ||
    (sourceSelect && TEXT_LIKE_TYPES.includes(target.type)) ||
    (["checkbox", ...TEXT_LIKE_TYPES, ...NUMERIC_LIKE_TYPES].includes(entry.fieldType) &&
      ["checkbox", ...TEXT_LIKE_TYPES, ...NUMERIC_LIKE_TYPES].includes(target.type)) ||
    (["person", "people"].includes(entry.fieldType) && ["person", "people"].includes(target.type)) ||
    (entry.fieldType === "attachment" && TEXT_LIKE_TYPES.includes(target.type));

  if (!compatible) return { ok: false };
  return {
    ok: true,
    value: migrateFieldValue(entry.fieldType, target.type, cloneValue(entry.value), parseFieldConfig(entry.fieldConfig)),
  };
}

export function rowClipboardPatch(payload: GridClipboardPayload, fields: FieldRow[]): Record<string, unknown> | null {
  if (payload.kind !== "row") return null;
  const sourceById = new Map(payload.entries.map((entry) => [entry.fieldId, entry]));
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    const source = sourceById.get(field.id);
    if (!source || !isGridFieldPasteable(field)) continue;
    const result = clipboardEntryToField(source, field);
    if (result.ok) patch[field.id] = result.value;
  }
  return Object.keys(patch).length ? patch : null;
}

/** Convert plain clipboard text (for example from Excel) to a cell's typed value. */
export function clipboardTextToField(text: string, target: FieldRow): ClipboardValueResult {
  if (!isGridFieldPasteable(target)) return { ok: false };
  const raw = text.replace(/\r\n/g, "\n");
  const trimmed = raw.trim();
  if (TEXT_LIKE_TYPES.includes(target.type) || target.type === "barcode") return { ok: true, value: raw };
  if (!trimmed) {
    if (target.type === "multi_select" || target.type === "people" || target.type === "attachment") return { ok: true, value: [] };
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
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return { ok: false };
    return { ok: true, value: target.type === "date" ? date.toISOString().slice(0, 10) : date.toISOString() };
  }
  if ([...SELECT_SINGLE_TYPES, ...SELECT_MULTI_TYPES].includes(target.type)) {
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
