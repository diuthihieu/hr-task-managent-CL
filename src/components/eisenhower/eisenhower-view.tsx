"use client";
import { useMemo, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { Maximize2, Settings2, Zap } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select } from "@/components/ui/misc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { getCellValue } from "@/lib/query-engine";
import type { EisenhowerConfig } from "@/lib/query-engine";
import { parseFieldConfig, SELECT_SINGLE_TYPES, type SelectOption } from "@/lib/field-types";
import { deriveUrgencyFromDueDate } from "@/lib/okr-engine";
import { formatDisplayValue } from "@/lib/format";
import { cn, initials } from "@/lib/utils";
import type { FieldRow, RecordRow } from "@/types";
import type { Member, OkrOptions } from "@/components/grid/cell";

interface Quadrant {
  key: string;
  importance: string;
  urgency: string;
  title: string;
  subtitle: string;
  accent: string;
}

const QUADRANTS: Quadrant[] = [
  { key: "urgent_important", importance: "important", urgency: "urgent", title: "Urgent & Important", subtitle: "DO", accent: "#ef4444" },
  { key: "not_urgent_important", importance: "important", urgency: "not_urgent", title: "Important, Not Urgent", subtitle: "SCHEDULE", accent: "#3b82f6" },
  { key: "urgent_not_important", importance: "not_important", urgency: "urgent", title: "Urgent, Not Important", subtitle: "DELEGATE", accent: "#f97316" },
  { key: "not_urgent_not_important", importance: "not_important", urgency: "not_urgent", title: "Not Urgent, Not Important", subtitle: "ELIMINATE / LOW PRIORITY", accent: "#94a3b8" },
];

export function EisenhowerView({
  fields,
  flatRecords,
  members,
  config,
  onConfigChange,
  onCellChange,
  onCellChangeMultiple,
  onOpenRecord,
  okrOptions,
}: {
  fields: FieldRow[];
  flatRecords: RecordRow[];
  members: Member[];
  config: EisenhowerConfig;
  onConfigChange: (patch: Partial<EisenhowerConfig>) => void;
  onCellChange: (recordId: string, fieldId: string, value: unknown) => void;
  onCellChangeMultiple: (recordId: string, patch: Record<string, unknown>) => void;
  onOpenRecord: (id: string) => void;
  okrOptions?: OkrOptions;
}) {
  const importanceField = fields.find((f) => f.id === config.importanceFieldId) ?? fields.find((f) => f.type === "importance");
  const urgencyField = fields.find((f) => f.id === config.urgencyFieldId) ?? fields.find((f) => f.type === "urgency");
  const dateFields = fields.filter((f) => f.type === "date" || f.type === "datetime");
  const dueDateField = fields.find((f) => f.id === config.dueDateFieldId) ?? dateFields[0];
  const primaryField = fields.find((f) => f.isPrimary);
  const cardFieldIds = config.cardFieldIds ?? fields.filter((f) => !f.isPrimary && f.visible && !["importance", "urgency"].includes(f.type)).slice(0, 3).map((f) => f.id);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [activeId, setActiveId] = useState<string | null>(null);

  const buckets = useMemo(() => {
    const map = new Map<string, RecordRow[]>(QUADRANTS.map((q) => [q.key, []]));
    if (!importanceField || !urgencyField) return map;
    for (const record of flatRecords) {
      const importance = (getCellValue(record, importanceField, fields) as string | null) ?? "not_important";
      const urgency = (getCellValue(record, urgencyField, fields) as string | null) ?? "not_urgent";
      const quadrant = QUADRANTS.find((q) => q.importance === importance && q.urgency === urgency) ?? QUADRANTS[3];
      map.get(quadrant.key)!.push(record);
    }
    return map;
  }, [flatRecords, importanceField, urgencyField, fields]);

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || !importanceField || !urgencyField) return;
    const quadrant = QUADRANTS.find((q) => q.key === String(over.id));
    if (!quadrant) return;
    onCellChangeMultiple(String(active.id), { [importanceField.id]: quadrant.importance, [urgencyField.id]: quadrant.urgency });
  }

  async function autoSetUrgency() {
    if (!urgencyField || !dueDateField) return;
    const withinDays = config.urgentWithinDays ?? 3;
    let count = 0;
    for (const record of flatRecords) {
      const due = getCellValue(record, dueDateField, fields) as string | null;
      const next = deriveUrgencyFromDueDate(due, withinDays);
      const current = getCellValue(record, urgencyField, fields);
      if (current !== next) {
        onCellChange(record.id, urgencyField.id, next);
        count++;
      }
    }
    toast.success(count ? `Updated urgency on ${count} task${count === 1 ? "" : "s"}` : "Everything already matches the rule");
  }

  if (!importanceField || !urgencyField) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-neutral-400">
        This table has no Importance/Urgency field yet - recreate the Eisenhower view or add them from + Add field.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-neutral-100 dark:border-neutral-900 shrink-0">
        <EisenhowerSettings
          fields={fields}
          config={{ ...config, cardFieldIds, importanceFieldId: importanceField.id, urgencyFieldId: urgencyField.id, dueDateFieldId: dueDateField?.id }}
          onChange={onConfigChange}
          onAutoSetUrgency={dueDateField ? autoSetUrgency : undefined}
        />
      </div>
      <DndContext sensors={sensors} onDragStart={(e) => setActiveId(String(e.active.id))} onDragEnd={handleDragEnd} onDragCancel={() => setActiveId(null)}>
        <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-2.5 p-2.5 overflow-auto">
          {QUADRANTS.map((q) => (
            <QuadrantColumn
              key={q.key}
              quadrant={q}
              records={buckets.get(q.key) ?? []}
              fields={fields}
              primaryField={primaryField}
              cardFieldIds={cardFieldIds}
              members={members}
              okrOptions={okrOptions}
              activeId={activeId}
              onOpenRecord={onOpenRecord}
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function QuadrantColumn({
  quadrant,
  records,
  fields,
  primaryField,
  cardFieldIds,
  members,
  okrOptions,
  activeId,
  onOpenRecord,
}: {
  quadrant: Quadrant;
  records: RecordRow[];
  fields: FieldRow[];
  primaryField: FieldRow | undefined;
  cardFieldIds: string[];
  members: Member[];
  okrOptions: OkrOptions | undefined;
  activeId: string | null;
  onOpenRecord: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: quadrant.key });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-lg border overflow-hidden min-h-0",
        isOver ? "ring-2 ring-indigo-400 border-transparent" : "border-neutral-200 dark:border-neutral-800"
      )}
      style={{ backgroundColor: `${quadrant.accent}0a` }}
    >
      <div className="flex items-center gap-2 px-3 h-10 shrink-0 border-b" style={{ borderColor: `${quadrant.accent}33` }}>
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: quadrant.accent }} />
        <div className="min-w-0">
          <div className="text-xs font-semibold truncate" style={{ color: quadrant.accent }}>
            {quadrant.subtitle}
          </div>
          <div className="text-[10px] text-neutral-500 dark:text-neutral-400 truncate">{quadrant.title}</div>
        </div>
        <span className="ml-auto text-xs text-neutral-400 shrink-0">{records.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto thin-scroll p-2 space-y-2 min-h-[80px]">
        {records.map((record) => (
          <EisenhowerCard
            key={record.id}
            record={record}
            fields={fields}
            primaryField={primaryField}
            cardFieldIds={cardFieldIds}
            members={members}
            okrOptions={okrOptions}
            dragging={activeId === record.id}
            onOpen={() => onOpenRecord(record.id)}
          />
        ))}
        {records.length === 0 && <div className="text-xs text-neutral-300 dark:text-neutral-700 text-center py-6">Drop tasks here</div>}
      </div>
    </div>
  );
}

function EisenhowerCard({
  record,
  fields,
  primaryField,
  cardFieldIds,
  members,
  okrOptions,
  dragging,
  onOpen,
}: {
  record: RecordRow;
  fields: FieldRow[];
  primaryField: FieldRow | undefined;
  cardFieldIds: string[];
  members: Member[];
  okrOptions: OkrOptions | undefined;
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
          return <EisenhowerFieldChip key={fid} field={field} value={value} members={members} okrOptions={okrOptions} />;
        })}
      </div>
    </div>
  );
}

function Badge({ option }: { option: SelectOption }) {
  return (
    <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: `${option.color}22`, color: option.color }}>
      {option.label}
    </span>
  );
}

function EisenhowerFieldChip({ field, value, members, okrOptions }: { field: FieldRow; value: unknown; members: Member[]; okrOptions: OkrOptions | undefined }) {
  const cfg = parseFieldConfig(field.config);
  if (SELECT_SINGLE_TYPES.includes(field.type)) {
    const option = cfg.options?.find((o) => o.id === value);
    return option ? <Badge option={option} /> : null;
  }
  if (field.type === "okr_objective") {
    const title = okrOptions?.objectives.find((o) => o.id === value)?.title;
    return title ? <div className="text-xs text-indigo-600 dark:text-indigo-400 truncate">🎯 {title}</div> : null;
  }
  if (field.type === "okr_key_result") {
    const title = okrOptions?.keyResults.find((k) => k.id === value)?.title;
    return title ? <div className="text-xs text-teal-600 dark:text-teal-400 truncate">🔑 {title}</div> : null;
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

function EisenhowerSettings({
  fields,
  config,
  onChange,
  onAutoSetUrgency,
}: {
  fields: FieldRow[];
  config: EisenhowerConfig;
  onChange: (patch: Partial<EisenhowerConfig>) => void;
  onAutoSetUrgency?: () => void;
}) {
  const dateFields = fields.filter((f) => f.type === "date" || f.type === "datetime");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="flex items-center gap-1.5 h-7 px-2 rounded-md text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <Settings2 size={13} /> Eisenhower settings
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-3 space-y-3">
        <div>
          <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Card fields</label>
          <div className="max-h-32 overflow-y-auto thin-scroll border border-neutral-200 dark:border-neutral-800 rounded-md p-1.5 space-y-1">
            {fields
              .filter((f) => !f.isPrimary && !["importance", "urgency"].includes(f.type))
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
        <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800">
          <label className="text-[11px] font-medium text-neutral-500 mb-1 block flex items-center gap-1">
            <Zap size={11} /> Auto-set Urgency from due date
          </label>
          <div className="flex items-center gap-1.5">
            <Select className="flex-1" value={config.dueDateFieldId ?? ""} onValueChange={(v) => onChange({ dueDateFieldId: v || undefined })} options={[{ value: "", label: "None" }, ...dateFields.map((f) => ({ value: f.id, label: f.name }))]} placeholder="Due date field" />
            <Input type="number" min={0} className="w-16" value={config.urgentWithinDays ?? 3} onChange={(e) => onChange({ urgentWithinDays: Number(e.target.value) })} />
            <span className="text-[11px] text-neutral-400 shrink-0">days</span>
          </div>
          <p className="text-[11px] text-neutral-400 mt-1">Tasks due within this many days are marked Urgent.</p>
          <Button size="sm" variant="secondary" className="w-full mt-2" disabled={!onAutoSetUrgency} onClick={onAutoSetUrgency}>
            Apply now
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
