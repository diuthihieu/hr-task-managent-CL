"use client";
import { useMemo, useState } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Settings2, Maximize2 } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Select } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { getCellValue, resolveValueLabel } from "@/lib/query-engine";
import type { CalendarConfig } from "@/lib/query-engine";
import { formatDisplayValue } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FieldRow, RecordRow } from "@/types";
import type { Member } from "@/components/grid/cell";

const DATE_TYPES = ["date", "datetime"];
const COLOR_TYPES = ["single_select", "status", "person", "people"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface EventItem {
  record: RecordRow;
  date: Date;
  endDate: Date | null;
  label: string;
  color: string;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}
function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function isoKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CalendarView({
  fields,
  flatRecords,
  members,
  config,
  onConfigChange,
  onCellChange,
  onOpenRecord,
}: {
  fields: FieldRow[];
  flatRecords: RecordRow[];
  members: Member[];
  config: CalendarConfig;
  onConfigChange: (patch: Partial<CalendarConfig>) => void;
  onCellChange: (recordId: string, fieldId: string, value: unknown) => void;
  onOpenRecord: (id: string) => void;
}) {
  const dateFields = fields.filter((f) => DATE_TYPES.includes(f.type));
  const dateField = fields.find((f) => f.id === config.dateFieldId) ?? dateFields[0];
  const endDateField = fields.find((f) => f.id === config.endDateFieldId);
  const colorField = fields.find((f) => f.id === config.colorFieldId);
  const mode = config.mode ?? "month";
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));

  const events: EventItem[] = useMemo(() => {
    if (!dateField) return [];
    return flatRecords
      .map((record) => {
        const raw = getCellValue(record, dateField, fields);
        if (!raw) return null;
        const date = new Date(String(raw));
        if (Number.isNaN(date.getTime())) return null;
        const endRaw = endDateField ? getCellValue(record, endDateField, fields) : null;
        const endDate = endRaw ? new Date(String(endRaw)) : null;
        let color = "#6366f1";
        if (colorField) {
          const v = getCellValue(record, colorField, fields);
          if (["person", "people"].includes(colorField.type)) {
            const memberId = Array.isArray(v) ? v[0] : v;
            color = members.find((m) => m.id === memberId)?.avatarColor ?? color;
          } else if (v) {
            color = resolveValueLabel(colorField, String(v), members).color ?? color;
          }
        }
        const primaryField = fields.find((f) => f.isPrimary);
        const label = primaryField ? formatDisplayValue(primaryField, getCellValue(record, primaryField, fields), members) : "(untitled)";
        return { record, date, endDate: endDate && !Number.isNaN(endDate.getTime()) ? endDate : null, label, color };
      })
      .filter((e): e is EventItem => !!e);
  }, [flatRecords, dateField, endDateField, colorField, fields, members]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const ev of events) {
      const start = startOfDay(ev.date);
      const end = ev.endDate ? startOfDay(ev.endDate) : start;
      let cursorDay = start;
      let guard = 0;
      while (cursorDay <= end && guard < 366) {
        const key = isoKey(cursorDay);
        if (!map.has(key)) map.set(key, []);
        map.get(key)!.push(ev);
        cursorDay = addDays(cursorDay, 1);
        guard++;
      }
    }
    return map;
  }, [events]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  function moveEvent(ev: EventItem, newDay: Date) {
    if (!dateField) return;
    const deltaDays = Math.round((startOfDay(newDay).getTime() - startOfDay(ev.date).getTime()) / 86400000);
    if (deltaDays === 0) return;
    const newStart = addDays(ev.date, deltaDays);
    const iso = dateField.type === "datetime" ? newStart.toISOString() : newStart.toISOString().slice(0, 10);
    onCellChange(ev.record.id, dateField.id, iso);
    if (endDateField && ev.endDate) {
      const newEnd = addDays(ev.endDate, deltaDays);
      const isoEnd = endDateField.type === "datetime" ? newEnd.toISOString() : newEnd.toISOString().slice(0, 10);
      onCellChange(ev.record.id, endDateField.id, isoEnd);
    }
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over) return;
    const ev = events.find((x) => x.record.id === String(active.id));
    if (!ev) return;
    const [y, m, d] = String(over.id).split("-").map(Number);
    moveEvent(ev, new Date(y, m - 1, d));
  }

  function navigate(dir: -1 | 1) {
    setCursor((c) => {
      if (mode === "month") return new Date(c.getFullYear(), c.getMonth() + dir, 1);
      if (mode === "week") return addDays(c, dir * 7);
      return addDays(c, dir);
    });
  }

  if (!dateField) {
    return <div className="flex-1 flex items-center justify-center text-sm text-neutral-400">This table has no Date or Date Time field to build a calendar from yet.</div>;
  }

  const heading =
    mode === "month"
      ? cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })
      : mode === "week"
      ? `Week of ${addDays(cursor, -cursor.getDay()).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
      : cursor.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-neutral-100 dark:border-neutral-900 shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ChevronLeft size={14} />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => navigate(1)}>
          <ChevronRight size={14} />
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setCursor(startOfDay(new Date()))}>
          Today
        </Button>
        <span className="text-sm font-medium text-neutral-800 dark:text-neutral-100">{heading}</span>
        <div className="flex items-center rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden ml-2">
          {(["month", "week", "day"] as const).map((m) => (
            <button
              key={m}
              onClick={() => onConfigChange({ mode: m })}
              className={cn("px-2.5 h-6 text-xs capitalize", mode === m ? "bg-indigo-600 text-white" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800")}
            >
              {m}
            </button>
          ))}
        </div>
        <CalendarSettings fields={fields} dateFields={dateFields} config={config} onChange={onConfigChange} />
      </div>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        {mode === "month" && <MonthGrid cursor={cursor} eventsByDay={eventsByDay} onOpenRecord={onOpenRecord} />}
        {mode === "week" && <WeekRow cursor={cursor} eventsByDay={eventsByDay} onOpenRecord={onOpenRecord} />}
        {mode === "day" && <DayList cursor={cursor} eventsByDay={eventsByDay} onOpenRecord={onOpenRecord} />}
      </DndContext>
    </div>
  );
}

function DayCell({ day, inMonth, events, onOpenRecord, tall }: { day: Date; inMonth: boolean; events: EventItem[]; onOpenRecord: (id: string) => void; tall?: boolean }) {
  const key = isoKey(day);
  const { setNodeRef, isOver } = useDroppable({ id: key });
  const isToday = sameDay(day, new Date());
  const visible = tall ? events : events.slice(0, 3);
  const overflow = events.length - visible.length;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "border-b border-r border-neutral-100 dark:border-neutral-900 p-1 flex flex-col gap-0.5 overflow-hidden",
        !inMonth && "bg-neutral-50/60 dark:bg-neutral-900/40",
        isOver && "ring-2 ring-inset ring-indigo-400"
      )}
      style={{ minHeight: tall ? 400 : 92 }}
    >
      <span className={cn("text-xs shrink-0", isToday ? "h-5 w-5 rounded-full bg-indigo-600 text-white flex items-center justify-center" : "text-neutral-400 px-1", !inMonth && "opacity-50")}>
        {day.getDate()}
      </span>
      <div className="flex-1 overflow-y-auto thin-scroll space-y-0.5">
        {visible.map((ev) => (
          <EventChip key={ev.record.id + key} event={ev} onOpen={() => onOpenRecord(ev.record.id)} />
        ))}
        {overflow > 0 && <div className="text-[10px] text-neutral-400 px-1">+{overflow} more</div>}
      </div>
    </div>
  );
}

function EventChip({ event, onOpen }: { event: EventItem; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: event.record.id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, backgroundColor: `${event.color}22`, color: event.color }}
      className={cn("group/ev relative flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium truncate cursor-grab active:cursor-grabbing touch-none", isDragging && "opacity-40 z-20")}
      title={event.label}
    >
      <span className="truncate flex-1">{event.label}</span>
      <Maximize2 size={9} className="shrink-0 opacity-0 group-hover/ev:opacity-100" />
    </div>
  );
}

function MonthGrid({ cursor, eventsByDay, onOpenRecord }: { cursor: Date; eventsByDay: Map<string, EventItem[]>; onOpenRecord: (id: string) => void }) {
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const gridStart = addDays(monthStart, -monthStart.getDay());
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <div className="grid grid-cols-7 border-t border-l border-neutral-100 dark:border-neutral-900 sticky top-0 bg-white dark:bg-neutral-950 z-10">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-center text-[11px] font-medium text-neutral-400 py-1 border-r border-b border-neutral-100 dark:border-neutral-900">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border-l border-neutral-100 dark:border-neutral-900">
        {days.map((day) => (
          <DayCell key={isoKey(day)} day={day} inMonth={day.getMonth() === cursor.getMonth()} events={eventsByDay.get(isoKey(day)) ?? []} onOpenRecord={onOpenRecord} />
        ))}
      </div>
    </div>
  );
}

function WeekRow({ cursor, eventsByDay, onOpenRecord }: { cursor: Date; eventsByDay: Map<string, EventItem[]>; onOpenRecord: (id: string) => void }) {
  const weekStart = addDays(cursor, -cursor.getDay());
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <div className="grid grid-cols-7 border-t border-l border-neutral-100 dark:border-neutral-900">
        {days.map((day) => (
          <div key={isoKey(day)} className="border-r border-b border-neutral-100 dark:border-neutral-900 text-center text-[11px] font-medium text-neutral-500 py-1">
            {day.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 border-l border-neutral-100 dark:border-neutral-900">
        {days.map((day) => (
          <DayCell key={isoKey(day)} day={day} inMonth onOpenRecord={onOpenRecord} events={eventsByDay.get(isoKey(day)) ?? []} tall />
        ))}
      </div>
    </div>
  );
}

function DayList({ cursor, eventsByDay, onOpenRecord }: { cursor: Date; eventsByDay: Map<string, EventItem[]>; onOpenRecord: (id: string) => void }) {
  const events = eventsByDay.get(isoKey(cursor)) ?? [];
  const { setNodeRef, isOver } = useDroppable({ id: isoKey(cursor) });
  return (
    <div ref={setNodeRef} className={cn("flex-1 overflow-y-auto thin-scroll p-4 space-y-2", isOver && "ring-2 ring-inset ring-indigo-400")}>
      {events.length === 0 && <p className="text-sm text-neutral-400">No records on this day.</p>}
      {events.map((ev) => (
        <div key={ev.record.id} className="max-w-md">
          <EventChip event={ev} onOpen={() => onOpenRecord(ev.record.id)} />
        </div>
      ))}
    </div>
  );
}

function CalendarSettings({
  fields,
  dateFields,
  config,
  onChange,
}: {
  fields: FieldRow[];
  dateFields: FieldRow[];
  config: CalendarConfig;
  onChange: (patch: Partial<CalendarConfig>) => void;
}) {
  const colorFields = fields.filter((f) => COLOR_TYPES.includes(f.type));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="ml-auto flex items-center gap-1.5 h-7 px-2 rounded-md text-sm text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800">
          <Settings2 size={13} /> Calendar settings
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3 space-y-2.5">
        <div>
          <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Date field</label>
          <Select className="w-full" value={config.dateFieldId ?? ""} onValueChange={(v) => onChange({ dateFieldId: v })} options={dateFields.map((f) => ({ value: f.id, label: f.name }))} />
        </div>
        <div>
          <label className="text-[11px] font-medium text-neutral-500 mb-1 block">End date (optional)</label>
          <Select
            className="w-full"
            value={config.endDateFieldId ?? ""}
            onValueChange={(v) => onChange({ endDateFieldId: v || undefined })}
            options={[{ value: "", label: "None" }, ...dateFields.map((f) => ({ value: f.id, label: f.name }))]}
            placeholder="None"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium text-neutral-500 mb-1 block">Color by</label>
          <Select
            className="w-full"
            value={config.colorFieldId ?? ""}
            onValueChange={(v) => onChange({ colorFieldId: v || undefined })}
            options={[{ value: "", label: "None" }, ...colorFields.map((f) => ({ value: f.id, label: f.name }))]}
            placeholder="None"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
