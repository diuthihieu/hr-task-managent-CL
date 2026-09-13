"use client";
import { useMemo, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { Plus, Maximize2, Settings2 } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select } from "@/components/ui/misc";
import { getCellValue } from "@/lib/query-engine";
import type { KanbanConfig } from "@/lib/query-engine";
import { parseFieldConfig, SELECT_SINGLE_TYPES, type SelectOption } from "@/lib/field-types";
import { formatDisplayValue } from "@/lib/format";
import { cn, initials } from "@/lib/utils";
import type { FieldRow, RecordRow } from "@/types";
import type { Member } from "@/components/grid/cell";

const GROUPABLE_TYPES = [...SELECT_SINGLE_TYPES, "multi_select", "person"];

interface Column {
  key: string;
  label: string;
  color?: string;
  records: RecordRow[];
}

export function KanbanView({
  fields,
  flatRecords,
  members,
  config,
  onConfigChange,
  onCellChange,
  onOpenRecord,
  onAddRecord,
}: {
  fields: FieldRow[];
  flatRecords: RecordRow[];
  members: Member[];
  config: KanbanConfig;
  onConfigChange: (patch: Partial<KanbanConfig>) => void;
  onCellChange: (recordId: string, fieldId: string, value: unknown) => void;
  onOpenRecord: (id: string) => void;
  onAddRecord: (initialData?: Record<string, unknown>) => void;
}) {
  const groupableFields = fields.filter((f) => GROUPABLE_TYPES.includes(f.type));
  const groupField = fields.find((f) => f.id === config.groupFieldId) ?? groupableFields[0];
  const primaryField = fields.find((f) => f.isPrimary);
  const cardFieldIds = config.cardFieldIds ?? fields.filter((f) => !f.isPrimary && f.visible).slice(0, 3).map((f) => f.id);
  const isMulti = groupField?.type === "multi_select";
  const isPerson = groupField?.type === "person";

  const columns: Column[] = useMemo(() => {
    if (!groupField) return [];
    const cfg = parseFieldConfig(groupField.config);
    const buckets = new Map<string, RecordRow[]>();
    const order: { key: string; label: string; color?: string }[] = [];

    if (isPerson) {
      for (const m of members) {
        order.push({ key: m.id, label: m.name, color: m.avatarColor });
        buckets.set(m.id, []);
      }
    } else {
      for (const o of cfg.options ?? []) {
        order.push({ key: o.id, label: o.label, color: o.color });
        buckets.set(o.id, []);
      }
    }
    order.push({ key: "__empty__", label: `No ${groupField.name}` });
    buckets.set("__empty__", []);

    for (const record of flatRecords) {
      const raw = getCellValue(record, groupField, fields);
      const values: string[] = Array.isArray(raw) ? raw : raw ? [String(raw)] : [];
      if (!values.length) {
        buckets.get("__empty__")!.push(record);
        continue;
      }
      for (const v of values) {
        if (!buckets.has(v)) {
          order.push({ key: v, label: v });
          buckets.set(v, []);
        }
        buckets.get(v)!.push(record);
      }
    }

    return order.map((o) => ({ ...o, records: buckets.get(o.key) ?? [] }));
  }, [groupField, flatRecords, members, fields, isPerson]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeId, setActiveId] = useState<string | null>(null);

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || !groupField) return;
    const columnKey = String(over.id);
    const newValue = columnKey === "__empty__" ? (isMulti ? [] : null) : isMulti ? [columnKey] : columnKey;
    onCellChange(String(active.id), groupField.id, newValue);
  }

  if (!groupField) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-neutral-400">
        This table has no Single Select, Status, Multi Select or Person field to group Kanban columns by yet.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-neutral-100 dark:border-neutral-900 shrink-0">
        <KanbanSettings fields={fields} groupableFields={groupableFields} config={{ ...config, groupFieldId: groupField.id, cardFieldIds }} onChange={onConfigChange} />
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="flex-1 overflow-x-auto overflow-y-hidden thin-scroll">
          <div className="flex h-full gap-3 p-3" style={{ width: "max-content" }}>
            {columns.map((col) => (
              <KanbanColumn
                key={col.key}
                column={col}
                fields={fields}
                primaryField={primaryField}
                cardFieldIds={cardFieldIds}
                members={members}
                activeId={activeId}
                onOpenRecord={onOpenRecord}
                onAddCard={() => onAddRecord(groupField ? { [groupField.id]: col.key === "__empty__" ? undefined : isMulti ? [col.key] : col.key } : undefined)}
              />
            ))}
          </div>
        </div>
      </DndContext>
    </div>
  );
}

function KanbanColumn({
  column,
  fields,
  primaryField,
  cardFieldIds,
  members,
  activeId,
  onOpenRecord,
  onAddCard,
}: {
  column: Column;
  fields: FieldRow[];
  primaryField: FieldRow | undefined;
  cardFieldIds: string[];
  members: Member[];
  activeId: string | null;
  onOpenRecord: (id: string) => void;
  onAddCard: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col w-72 shrink-0 rounded-lg bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-800",
        isOver && "ring-2 ring-indigo-400"
      )}
    >
      <div className="flex items-center gap-1.5 px-3 h-9 shrink-0 border-b border-neutral-200 dark:border-neutral-800">
        {column.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: column.color }} />}
        <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200 truncate">{column.label}</span>
        <span className="text-xs text-neutral-400">{column.records.length}</span>
        <button onClick={onAddCard} className="ml-auto text-neutral-400 hover:text-indigo-600" title="Add card">
          <Plus size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll p-2 space-y-2 min-h-[60px]">
        {column.records.map((record) => (
          <KanbanCard
            key={record.id}
            record={record}
            fields={fields}
            primaryField={primaryField}
            cardFieldIds={cardFieldIds}
            members={members}
            dragging={activeId === record.id}
            onOpen={() => onOpenRecord(record.id)}
          />
        ))}
      </div>
    </div>
  );
}

function KanbanCard({
  record,
  fields,
  primaryField,
  cardFieldIds,
  members,
  dragging,
  onOpen,
}: {
  record: RecordRow;
  fields: FieldRow[];
  primaryField: FieldRow | undefined;
  cardFieldIds: string[];
  members: Member[];
  dragging: boolean;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: record.id });
  const title = primaryField ? formatDisplayValue(primaryField, getCellValue(record, primaryField, fields), members) : "Untitled";

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      className={cn(
        "group/card relative rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-2.5 shadow-sm cursor-grab active:cursor-grabbing touch-none",
        dragging && "opacity-40 z-20"
      )}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute top-2 right-2 opacity-0 group-hover/card:opacity-100 text-neutral-400 hover:text-indigo-600"
      >
        <Maximize2 size={12} />
      </button>
      <div className="text-sm font-medium text-neutral-900 dark:text-neutral-50 pr-4 mb-1.5">{title || "(untitled)"}</div>
      <div className="space-y-1">
        {cardFieldIds.map((fid) => {
          const field = fields.find((f) => f.id === fid);
          if (!field) return null;
          const value = getCellValue(record, field, fields);
          if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return null;
          return <KanbanFieldChip key={fid} field={field} value={value} members={members} />;
        })}
      </div>
    </div>
  );
}

function KanbanFieldChip({ field, value, members }: { field: FieldRow; value: unknown; members: Member[] }) {
  const cfg = parseFieldConfig(field.config);
  if (SELECT_SINGLE_TYPES.includes(field.type)) {
    const option = cfg.options?.find((o) => o.id === value);
    return option ? <Badge option={option} /> : null;
  }
  if (field.type === "multi_select" && Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((v) => {
          const option = cfg.options?.find((o) => o.id === v);
          return option ? <Badge key={v} option={option} /> : null;
        })}
      </div>
    );
  }
  if (["person", "people"].includes(field.type)) {
    const ids = Array.isArray(value) ? value : [value];
    const matched = members.filter((m) => ids.includes(m.id));
    if (!matched.length) return null;
    return (
      <div className="flex items-center gap-1">
        {matched.map((m) => (
          <span key={m.id} className="h-4 w-4 rounded-full flex items-center justify-center text-white text-[8px]" style={{ backgroundColor: m.avatarColor }} title={m.name}>
            {initials(m.name)}
          </span>
        ))}
      </div>
    );
  }
  return <div className="text-xs text-neutral-500 dark:text-neutral-400 truncate">{formatDisplayValue(field, value, members)}</div>;
}

function Badge({ option }: { option: SelectOption }) {
  return (
    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${option.color}22`, color: option.color }}>
      {option.label}
    </span>
  );
}

function KanbanSettings({
  fields,
  groupableFields,
  config,
  onChange,
}: {
  fields: FieldRow[];
  groupableFields: FieldRow[];
  config: KanbanConfig;
  onChange: (patch: Partial<KanbanConfig>) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 h-7 px-2 rounded-md text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <Settings2 size={13} /> Kanban settings
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-2.5">
        <div>
          <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Group columns by</label>
          <Select
            className="w-full"
            value={config.groupFieldId ?? ""}
            onValueChange={(v) => onChange({ groupFieldId: v })}
            options={groupableFields.map((f) => ({ value: f.id, label: f.name }))}
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Card fields</label>
          <div className="max-h-40 overflow-y-auto thin-scroll border border-neutral-200 dark:border-neutral-800 rounded-md p-1.5 space-y-1">
            {fields
              .filter((f) => f.id !== config.groupFieldId)
              .map((f) => {
                const checked = config.cardFieldIds?.includes(f.id) ?? false;
                return (
                  <label key={f.id} className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const current = config.cardFieldIds ?? [];
                        onChange({ cardFieldIds: e.target.checked ? [...current, f.id] : current.filter((id) => id !== f.id) });
                      }}
                    />
                    {f.name}
                  </label>
                );
              })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
