// Server-safe (no "use client") display formatting for a cell's raw stored
// value, shared by CSV/XLSX export and the dashboard Table widget - both
// need the same human-readable text a user sees in the Grid, not the raw
// option id / user id / ISO timestamp that's actually stored.

import { parseFieldConfig, type AttachmentValue } from "./field-types";
import type { FieldRow } from "@/types";

export interface FormatMember {
  id: string;
  name: string;
}

export function formatDisplayValue(field: FieldRow, value: unknown, members: FormatMember[] = []): string {
  if (value === null || value === undefined || value === "") return "";
  const config = parseFieldConfig(field.config);

  if (["single_select", "status"].includes(field.type)) {
    return config.options?.find((o) => o.id === value)?.label ?? String(value);
  }
  if (field.type === "multi_select" && Array.isArray(value)) {
    return value.map((v) => config.options?.find((o) => o.id === v)?.label ?? String(v)).join(", ");
  }
  if (field.type === "attachment" && Array.isArray(value)) {
    return (value as AttachmentValue[]).map((a) => a.name).join(", ");
  }
  if (field.type === "person" && typeof value === "string") {
    return members.find((m) => m.id === value)?.name ?? value;
  }
  if (field.type === "people" && Array.isArray(value)) {
    return value.map((id) => members.find((m) => m.id === id)?.name ?? String(id)).join(", ");
  }
  if (field.type === "created_by" && typeof value === "string") {
    return members.find((m) => m.id === value)?.name ?? value;
  }
  if (field.type === "link" && Array.isArray(value)) {
    return `${value.length} linked`;
  }
  if (["date", "datetime", "created_time", "modified_time"].includes(field.type) && typeof value === "string") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return field.type === "datetime" || field.type === "modified_time" || field.type === "created_time"
      ? d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  if (field.type === "checkbox" || typeof value === "boolean") return value ? "Yes" : "No";
  if (field.type === "currency") return `${config.currencySymbol ?? "$"}${value}`;
  if (field.type === "percent") return `${value}%`;
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}
