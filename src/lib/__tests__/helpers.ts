import type { FieldRow, RecordRow } from "@/types";

export function field(id: string, name: string, type: string, config?: object, extra: Partial<FieldRow> = {}): FieldRow {
  return {
    id,
    tableId: "t1",
    name,
    type,
    config: config ? JSON.stringify(config) : null,
    order: 0,
    isPrimary: false,
    visible: true,
    description: null,
    defaultValue: null,
    ...extra,
  };
}

export function record(id: string, data: Record<string, unknown>, order = 0): RecordRow {
  return { id, tableId: "t1", data, order, createdById: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
}
