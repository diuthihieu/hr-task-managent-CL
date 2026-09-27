"use client";
import { useMemo, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Cell, type Member, type LinkTarget } from "@/components/grid/cell";
import { GanttSettings } from "./gantt-settings";
import { getCellValue, type RecordGroup, type GanttConfig } from "@/lib/query-engine";
import { parseFieldConfig } from "@/lib/field-types";
import { cn, initials } from "@/lib/utils";
import type { FieldRow, RecordRow } from "@/types";
import { useT } from "@/components/i18n-provider";

const ZOOM_PX_PER_DAY: Record<string, number> = { day: 36, week: 14, month: 5 };
const ZOOM_PADDING_DAYS: Record<string, number> = { day: 3, week: 7, month: 30 };
const TASK_ROW_HEIGHT = 40;
const GROUP_ROW_HEIGHT = 30;
const NAME_COL_WIDTH = 240;

interface GanttViewProps {
  fields: FieldRow[];
  groups: RecordGroup[] | null;
  flatRecords: RecordRow[];
  members: Member[];
  linkTargets: Record<string, LinkTarget>;
  config: GanttConfig;
  onConfigChange: (patch: Partial<GanttConfig>) => void;
  onCellChange: (recordId: string, fieldId: string, value: unknown) => void;
  onOpenRecord: (id: string) => void;
}

interface Task {
  record: RecordRow;
  name: string;
  start: Date | null;
  end: Date | null;
  progress: number | null;
  color: string;
  dependsOn: string[];
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}
function daysBetween(a: Date, b: Date) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000);
}
function toDateOnly(iso: string | null) {
  return iso ? startOfDay(new Date(iso)) : null;
}

export function GanttView(props: GanttViewProps) {
  const { t } = useT();
  const { fields, groups, flatRecords, members, linkTargets, config, onConfigChange, onCellChange, onOpenRecord } = props;

  const primaryField = fields.find((f) => f.isPrimary);
  const taskField = fields.find((f) => f.id === config.taskFieldId) ?? primaryField ?? fields[0];
  const startField = fields.find((f) => f.id === config.startFieldId) ?? fields.find((f) => ["date", "datetime"].includes(f.type));
  const endField =
    fields.find((f) => f.id === config.endFieldId) ??
    fields.find((f) => ["date", "datetime"].includes(f.type) && f.id !== startField?.id) ??
    startField;
  const progressField = fields.find((f) => f.id === config.progressFieldId) ?? fields.find((f) => f.type === "progress");
  const ownerField = fields.find((f) => f.id === config.ownerFieldId) ?? fields.find((f) => ["person", "people"].includes(f.type));
  const statusField = fields.find((f) => f.id === config.statusFieldId) ?? fields.find((f) => ["status", "single_select"].includes(f.type));
  const dependencyField = fields.find((f) => f.id === config.dependencyFieldId) ?? fields.find((f) => f.type === "link");

  const zoom = config.zoom ?? "day";
  const pxPerDay = ZOOM_PX_PER_DAY[zoom];

  const recordIds = useMemo(() => new Set(flatRecords.map((r) => r.id)), [flatRecords]);

  const tasksById = useMemo(() => {
    const map = new Map<string, Task>();
    for (const record of flatRecords) {
      const name = taskField ? String(getCellValue(record, taskField, fields) ?? "") : "";
      const start = startField ? toDateOnly(getCellValue(record, startField, fields) as string | null) : null;
      const end = endField ? toDateOnly(getCellValue(record, endField, fields) as string | null) : start;
      const progress = progressField ? (getCellValue(record, progressField, fields) as number | null) : null;
      let color = "#6366f1";
      if (statusField) {
        const cfg = parseFieldConfig(statusField.config);
        const v = getCellValue(record, statusField, fields);
        color = cfg.options?.find((o) => o.id === v)?.color ?? color;
      }
      const depValue = dependencyField ? getCellValue(record, dependencyField, fields) : null;
      const dependsOn = (Array.isArray(depValue) ? (depValue as string[]) : []).filter((id) => recordIds.has(id) && id !== record.id);
      map.set(record.id, { record, name, start, end: end ?? start, progress, color, dependsOn });
    }
    return map;
  }, [flatRecords, taskField, startField, endField, progressField, statusField, dependencyField, fields, recordIds]);

  const { rangeStart, totalDays } = useMemo(() => {
    const padding = ZOOM_PADDING_DAYS[zoom];
    const dated = [...tasksById.values()].filter((t) => t.start);
    if (!dated.length) {
      const today = startOfDay(new Date());
      return { rangeStart: addDays(today, -7), totalDays: 45 };
    }
    let min = dated[0].start!;
    let max = dated[0].end ?? dated[0].start!;
    for (const t of dated) {
      if (t.start! < min) min = t.start!;
      const end = t.end ?? t.start!;
      if (end > max) max = end;
    }
    const start = addDays(min, -padding);
    const days = daysBetween(max, min) + padding * 2 + 1;
    return { rangeStart: start, totalDays: Math.max(days, 14) };
  }, [tasksById, zoom]);

  const timelineWidth = totalDays * pxPerDay;

  const monthBands = useMemo(() => {
    const bands: { label: string; days: number }[] = [];
    for (let i = 0; i < totalDays; i++) {
      const d = addDays(rangeStart, i);
      const label = d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
      if (bands.length && bands[bands.length - 1].label === label) bands[bands.length - 1].days++;
      else bands.push({ label, days: 1 });
    }
    return bands;
  }, [rangeStart, totalDays]);

  const fineTicks = useMemo(() => {
    if (zoom === "month") return [];
    const step = zoom === "week" ? 7 : 1;
    const ticks: { x: number; label: string }[] = [];
    for (let i = 0; i < totalDays; i += step) {
      const d = addDays(rangeStart, i);
      ticks.push({ x: i * pxPerDay, label: zoom === "week" ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : String(d.getDate()) });
    }
    return ticks;
  }, [rangeStart, totalDays, zoom, pxPerDay]);

  const todayX = daysBetween(startOfDay(new Date()), rangeStart) * pxPerDay;

  // Flatten into a render list so group headers and task rows share one
  // vertical rhythm - needed to compute row Y positions for dependency lines.
  const rows = useMemo(() => {
    const list: Array<{ type: "group"; group: RecordGroup } | { type: "task"; record: RecordRow }> = [];
    if (groups) {
      for (const g of groups) {
        list.push({ type: "group", group: g });
        for (const r of g.records) list.push({ type: "task", record: r });
      }
    } else {
      for (const r of flatRecords) list.push({ type: "task", record: r });
    }
    return list;
  }, [groups, flatRecords]);

  const rowTop = useMemo(() => {
    const map = new Map<string, number>();
    let y = 0;
    for (const row of rows) {
      if (row.type === "group") {
        y += GROUP_ROW_HEIGHT;
      } else {
        map.set(row.record.id, y);
        y += TASK_ROW_HEIGHT;
      }
    }
    return map;
  }, [rows]);

  const totalHeight = rows.reduce((h, r) => h + (r.type === "group" ? GROUP_ROW_HEIGHT : TASK_ROW_HEIGHT), 0);

  const dependencyEdges = useMemo(() => {
    const edges: { from: string; to: string }[] = [];
    for (const task of tasksById.values()) {
      for (const dep of task.dependsOn) {
        if (rowTop.has(dep) && rowTop.has(task.record.id)) edges.push({ from: dep, to: task.record.id });
      }
    }
    return edges;
  }, [tasksById, rowTop]);

  function barRect(task: Task) {
    if (!task.start) return null;
    const end = task.end ?? task.start;
    const left = daysBetween(task.start, rangeStart) * pxPerDay;
    const width = Math.max(pxPerDay * 0.6, (daysBetween(end, task.start) + 1) * pxPerDay - 3);
    return { left, width };
  }

  const [dragState, setDragState] = useState<{ recordId: string; mode: "move" | "resize-start" | "resize-end" } | null>(null);
  const dragRef = useRef<{ recordId: string; mode: "move" | "resize-start" | "resize-end"; startX: number } | null>(null);

  function startDrag(recordId: string, mode: "move" | "resize-start" | "resize-end", e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const found = tasksById.get(recordId);
    if (!found || !found.start) return;
    const task: Task = found;
    dragRef.current = { recordId, mode, startX: e.clientX };
    setDragState({ recordId, mode });

    function onMove(ev: MouseEvent) {
      const d = dragRef.current;
      if (!d) return;
      const el = document.getElementById(`gantt-bar-${d.recordId}`);
      if (!el) return;
      const deltaDays = Math.round((ev.clientX - d.startX) / pxPerDay);
      const rect = barRect(task);
      if (!rect) return;
      if (d.mode === "move") {
        el.style.transform = `translateX(${deltaDays * pxPerDay}px)`;
      } else if (d.mode === "resize-start") {
        const newWidth = Math.max(pxPerDay * 0.6, rect.width - deltaDays * pxPerDay);
        el.style.width = `${newWidth}px`;
        el.style.transform = `translateX(${rect.width - newWidth}px)`;
      } else {
        el.style.width = `${Math.max(pxPerDay * 0.6, rect.width + deltaDays * pxPerDay)}px`;
      }
    }
    function onUp(ev: MouseEvent) {
      const d = dragRef.current;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      dragRef.current = null;
      setDragState(null);
      if (!d) return;
      const deltaDays = Math.round((ev.clientX - d.startX) / pxPerDay);
      if (deltaDays === 0) return;
      const t = tasksById.get(d.recordId);
      if (!t || !t.start || !startField) return;
      const end = t.end ?? t.start;
      if (d.mode === "move") {
        const newStart = addDays(t.start, deltaDays);
        const newEnd = addDays(end, deltaDays);
        onCellChange(d.recordId, startField.id, newStart.toISOString().slice(0, 10));
        if (endField) onCellChange(d.recordId, endField.id, newEnd.toISOString().slice(0, 10));
      } else if (d.mode === "resize-start") {
        let newStart = addDays(t.start, deltaDays);
        if (newStart > end) newStart = end;
        onCellChange(d.recordId, startField.id, newStart.toISOString().slice(0, 10));
      } else if (endField) {
        let newEnd = addDays(end, deltaDays);
        if (newEnd < t.start) newEnd = t.start;
        onCellChange(d.recordId, endField.id, newEnd.toISOString().slice(0, 10));
      }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const missingDates = !startField;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 h-9 border-b border-neutral-100 dark:border-neutral-900 shrink-0">
        <div className="flex items-center rounded-md border border-neutral-200 dark:border-neutral-800 overflow-hidden">
          {(["day", "week", "month"] as const).map((z) => (
            <button
              key={z}
              onClick={() => onConfigChange({ zoom: z })}
              className={cn(
                "px-2.5 h-6 text-xs capitalize",
                zoom === z ? "bg-indigo-600 text-white" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              )}
            >
              {z}
            </button>
          ))}
        </div>
        <GanttSettings fields={fields} config={config} onChange={onConfigChange} />
        {missingDates && <span className="text-xs text-amber-600 dark:text-amber-500">{t("gt.missingDates")}</span>}
      </div>

      <div className="flex-1 overflow-auto thin-scroll">
        <div style={{ position: "relative", width: NAME_COL_WIDTH + timelineWidth }}>
          {/* Header */}
          <div className="flex sticky top-0 z-20 bg-neutral-50 dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800">
            <div className="sticky left-0 z-30 shrink-0 bg-neutral-50 dark:bg-neutral-900 border-r border-neutral-200 dark:border-neutral-800 flex items-end px-2 pb-1 text-xs font-medium text-neutral-500" style={{ width: NAME_COL_WIDTH, height: 44 }}>
              Task
            </div>
            <div style={{ width: timelineWidth }}>
              <div className="flex h-5">
                {monthBands.map((b, i) => (
                  <div key={i} className="shrink-0 border-r border-neutral-200 dark:border-neutral-800 text-[11px] text-neutral-500 px-1.5 flex items-center" style={{ width: b.days * pxPerDay }}>
                    {b.label}
                  </div>
                ))}
              </div>
              {zoom !== "month" ? (
                <div className="flex h-[19px] relative">
                  {fineTicks.map((t, i) => (
                    <div key={i} className="absolute top-0 h-full border-r border-neutral-100 dark:border-neutral-900 text-[10px] text-neutral-400 pl-1 flex items-center" style={{ left: t.x, width: (zoom === "week" ? 7 : 1) * pxPerDay }}>
                      {t.label}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="h-[19px]" />
              )}
            </div>
          </div>

          {/* Rows */}
          <div style={{ position: "relative" }}>
            {rows.map((row, i) =>
              row.type === "group" ? (
                <div key={`g-${i}`} className="flex sticky left-0" style={{ height: GROUP_ROW_HEIGHT, width: NAME_COL_WIDTH + timelineWidth }}>
                  <div className="w-full bg-neutral-100 dark:bg-neutral-800/60 border-b border-neutral-200 dark:border-neutral-800 flex items-center px-2 gap-1.5 text-sm font-medium text-neutral-700 dark:text-neutral-200 sticky left-0" style={{ width: NAME_COL_WIDTH + timelineWidth }}>
                    {row.group.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: row.group.color }} />}
                    {row.group.label}
                    <span className="text-neutral-400 font-normal">{row.group.records.length}</span>
                  </div>
                </div>
              ) : (
                <GanttRow
                  key={row.record.id}
                  record={row.record}
                  task={tasksById.get(row.record.id)!}
                  taskField={taskField}
                  ownerField={ownerField}
                  fields={fields}
                  members={members}
                  linkTargets={linkTargets}
                  rect={barRect(tasksById.get(row.record.id)!)}
                  dragging={dragState?.recordId === row.record.id}
                  onCellChange={onCellChange}
                  onOpenRecord={onOpenRecord}
                  onStartDrag={startDrag}
                />
              )
            )}

            {/* Today marker */}
            {todayX >= 0 && todayX <= timelineWidth && (
              <div className="absolute top-0 w-px bg-red-400 z-10 pointer-events-none" style={{ left: NAME_COL_WIDTH + todayX, height: totalHeight }} />
            )}

            {/* Dependency lines */}
            <svg
              className="absolute top-0 pointer-events-none"
              style={{ left: NAME_COL_WIDTH, width: timelineWidth, height: totalHeight }}
              width={timelineWidth}
              height={totalHeight}
            >
              <defs>
                <marker id="gantt-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#94a3b8" />
                </marker>
              </defs>
              {dependencyEdges.map((edge, i) => {
                const fromTask = tasksById.get(edge.from);
                const toTask = tasksById.get(edge.to);
                const fromRect = fromTask && barRect(fromTask);
                const toRect = toTask && barRect(toTask);
                const fromY = rowTop.get(edge.from);
                const toY = rowTop.get(edge.to);
                if (!fromRect || !toRect || fromY === undefined || toY === undefined) return null;
                const x1 = fromRect.left + fromRect.width;
                const y1 = fromY + TASK_ROW_HEIGHT / 2;
                const x2 = toRect.left;
                const y2 = toY + TASK_ROW_HEIGHT / 2;
                const midX = x1 + Math.max(10, (x2 - x1) / 2);
                return (
                  <path
                    key={i}
                    d={`M${x1},${y1} L${midX},${y1} L${midX},${y2} L${x2 - 6},${y2}`}
                    fill="none"
                    stroke="#94a3b8"
                    strokeWidth={1.5}
                    markerEnd="url(#gantt-arrow)"
                  />
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function GanttRow({
  record,
  task,
  taskField,
  ownerField,
  fields,
  members,
  linkTargets,
  rect,
  dragging,
  onCellChange,
  onOpenRecord,
  onStartDrag,
}: {
  record: RecordRow;
  task: Task;
  taskField: FieldRow | undefined;
  ownerField: FieldRow | undefined;
  fields: FieldRow[];
  members: Member[];
  linkTargets: Record<string, LinkTarget>;
  rect: { left: number; width: number } | null;
  dragging: boolean;
  onCellChange: (recordId: string, fieldId: string, value: unknown) => void;
  onOpenRecord: (id: string) => void;
  onStartDrag: (recordId: string, mode: "move" | "resize-start" | "resize-end", e: React.MouseEvent) => void;
}) {
  const { t } = useT();
  const owner = ownerField ? (getCellValue(record, ownerField, fields) as string | string[] | null) : null;
  const ownerIds = Array.isArray(owner) ? owner : owner ? [owner] : [];
  const ownerMembers = members.filter((m) => ownerIds.includes(m.id));

  return (
    <div className="flex group/gr hover:bg-neutral-50 dark:hover:bg-neutral-900/60" style={{ height: TASK_ROW_HEIGHT }}>
      <div className="sticky left-0 z-10 bg-white dark:bg-neutral-950 border-b border-r border-neutral-100 dark:border-neutral-900 flex items-center" style={{ width: NAME_COL_WIDTH }}>
        <button onClick={() => onOpenRecord(record.id)} className="opacity-0 group-hover/gr:opacity-100 shrink-0 ml-1 text-neutral-400 hover:text-indigo-600" title={t("grid.expand")}>
          <Maximize2 size={12} />
        </button>
        <div className="flex-1 h-full overflow-hidden">
          {taskField ? <Cell field={taskField} value={task.name} record={record} members={members} linkTargets={linkTargets} onChange={(v) => onCellChange(record.id, taskField.id, v)} /> : null}
        </div>
      </div>
      <div className="relative border-b border-neutral-100 dark:border-neutral-900" style={{ width: "100%" }}>
        {rect ? (
          <div
            id={`gantt-bar-${record.id}`}
            className={cn("absolute top-1.5 rounded-md shadow-sm cursor-grab active:cursor-grabbing flex items-center overflow-visible", dragging && "z-20 opacity-90")}
            style={{ left: rect.left, width: rect.width, height: TASK_ROW_HEIGHT - 12, backgroundColor: `${task.color}30`, border: `1.5px solid ${task.color}` }}
            onMouseDown={(e) => onStartDrag(record.id, "move", e)}
          >
            <div className="h-full rounded-l-md" style={{ width: `${Math.max(0, Math.min(100, task.progress ?? 0))}%`, backgroundColor: task.color }} />
            <span className="absolute left-1.5 text-[11px] font-medium text-neutral-800 dark:text-neutral-100 truncate max-w-[calc(100%-8px)] pointer-events-none">
              {rect.width > 60 ? task.name : ""}
            </span>
            {ownerMembers.length > 0 && (
              <span
                className="absolute -right-2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full flex items-center justify-center text-white text-[8px] border border-white dark:border-neutral-950"
                style={{ backgroundColor: ownerMembers[0].avatarColor }}
              >
                {initials(ownerMembers[0].name)}
              </span>
            )}
            <div className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize" onMouseDown={(e) => onStartDrag(record.id, "resize-start", e)} />
            <div className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize" onMouseDown={(e) => onStartDrag(record.id, "resize-end", e)} />
          </div>
        ) : (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-neutral-300 dark:text-neutral-700">{t("gt.noDates")}</span>
        )}
      </div>
    </div>
  );
}
