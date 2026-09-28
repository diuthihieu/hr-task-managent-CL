"use client";
import { useState } from "react";
import { Star, User as UserIcon, Link2, Check, Paperclip, Plus, X, Target, KeySquare } from "lucide-react";
import { Checkbox } from "@/components/ui/misc";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getFieldType, parseFieldConfig, resolveOkrTarget, SELECT_SINGLE_TYPES, type SelectOption, type AttachmentValue } from "@/lib/field-types";
import { cn, initials, formatDate } from "@/lib/utils";
import type { FieldRow, RecordRow } from "@/types";
import { AttachmentsCell, type CellFile } from "./attachments-cell";

export interface Member {
  id: string;
  name: string;
  avatarColor: string;
}

export interface LinkTarget {
  records: { id: string; label: string }[];
}

export interface OkrOptions {
  objectives: { id: string; title: string }[];
  keyResults: { id: string; title: string; objectiveId: string }[];
}

interface CellProps {
  field: FieldRow;
  value: unknown;
  record: RecordRow;
  members: Member[];
  linkTargets?: Record<string, LinkTarget>; // keyed by field.id, for `link` fields
  okrOptions?: OkrOptions; // for `okr_objective` / `okr_key_result` fields
  onChange: (value: unknown) => void;
  readOnlyOverride?: boolean;
  /** Row Height = "Auto Fit Content": wrap text instead of single-line truncating, growing the row to fit (capped by maxHeight). */
  wrapText?: boolean;
  maxHeight?: number;
  columnWidth?: number;
}

// Rough chars-per-line estimate from a column's pixel width, for sizing an
// auto-growing textarea without a full text-measurement/ResizeObserver pass -
// good enough to make longer content visibly take more rows, not pixel-exact.
const AVG_CHAR_PX = 6.5;
function estimateRows(value: string, columnWidthPx: number | undefined, maxRows: number): number {
  if (!value) return 1;
  const charsPerLine = Math.max(10, Math.floor((columnWidthPx ?? 180) / AVG_CHAR_PX));
  const lines = value.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
  return Math.max(1, Math.min(maxRows, lines));
}

// Text-like cells keep a local draft and only commit on blur / Enter, so the
// server sees one update per edit (one activity-log entry, one validation)
// instead of one request per keystroke.
type DraftProps<T extends HTMLInputElement | HTMLTextAreaElement> = Omit<React.InputHTMLAttributes<T> & React.TextareaHTMLAttributes<T>, "value" | "onChange"> & {
  value: string | number;
  onCommit: (raw: string) => void;
};

function useDraft(value: string | number, onCommit: (raw: string) => void) {
  const external = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(external);
  const [focused, setFocused] = useState(false);
  const [lastExternal, setLastExternal] = useState(external);
  if (!focused && external !== lastExternal) {
    setLastExternal(external);
    setDraft(external);
  }
  const commit = () => {
    if (draft !== external) onCommit(draft);
  };
  return { draft, setDraft, setFocused, commit, external };
}

function DraftInput({ value, onCommit, ...rest }: DraftProps<HTMLInputElement>) {
  const d = useDraft(value, onCommit);
  return (
    <input
      {...(rest as React.InputHTMLAttributes<HTMLInputElement>)}
      value={d.draft}
      onFocus={() => d.setFocused(true)}
      onChange={(e) => d.setDraft(e.target.value)}
      onBlur={() => {
        d.setFocused(false);
        d.commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          d.setDraft(d.external);
          setTimeout(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

function DraftTextarea({ value, onCommit, ...rest }: DraftProps<HTMLTextAreaElement>) {
  const d = useDraft(value, onCommit);
  return (
    <textarea
      {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
      value={d.draft}
      onFocus={() => d.setFocused(true)}
      onChange={(e) => d.setDraft(e.target.value)}
      onBlur={() => {
        d.setFocused(false);
        d.commit();
      }}
    />
  );
}

/**
 * Draggable progress slider. The value is local while dragging and committed
 * once on release (pointer up / keyboard / blur), so one drag = one update.
 * Pointer events stop here so the row's drag-to-reorder never starts.
 */
function ProgressCell({ value, className, onChange }: { value: number; className: string; onChange: (v: number) => void }) {
  const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
  const external = clamp(Number(value) || 0);
  const [draft, setDraft] = useState<number | null>(null);
  const shown = draft ?? external;
  const commit = () => {
    if (draft !== null && draft !== external) onChange(draft);
    setDraft(null);
  };
  return (
    <div className={cn(className, "gap-2")} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={shown}
        aria-label="Progress"
        data-testid="progress-slider"
        onChange={(e) => setDraft(clamp(Number(e.target.value)))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="progress-range flex-1 min-w-0 cursor-pointer"
        style={{ ["--pct" as string]: `${shown}%` }}
      />
      <DraftInput
        type="number"
        min={0}
        max={100}
        className="w-9 bg-transparent outline-none text-xs text-neutral-500 tabular-nums text-right"
        value={shown}
        onCommit={(v) => onChange(clamp(Number(v) || 0))}
      />
      <span className="text-[10px] text-neutral-400 -ml-1.5">%</span>
    </div>
  );
}

function OptionBadge({ option }: { option: SelectOption }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium truncate max-w-full"
      style={{ backgroundColor: `${option.color}22`, color: option.color }}
    >
      {option.label}
    </span>
  );
}

export function Cell({ field, value, record, members, linkTargets, okrOptions, wrapText, maxHeight, columnWidth, onChange, readOnlyOverride }: CellProps) {
  const typeDef = getFieldType(field.type);
  const config = parseFieldConfig(field.config);
  const base = "h-full w-full flex items-center px-2 text-sm";

  if (readOnlyOverride) {
    return <div className={cn(base, "text-neutral-700 dark:text-neutral-300 truncate")}>{CellDisplayValue(field, value) || <span className="text-neutral-300">—</span>}</div>;
  }

  if (typeDef.comingSoon) {
    return <div className={cn(base, "text-neutral-300 dark:text-neutral-700")}>—</div>;
  }

  switch (field.type) {
    case "text":
    case "long_text": {
      if (wrapText) {
        const maxRows = field.type === "long_text" ? 10 : 6;
        const rows = estimateRows((value as string) ?? "", columnWidth, maxRows);
        return (
          <DraftTextarea
            rows={rows}
            className="w-full bg-transparent outline-none resize-none text-sm text-neutral-800 dark:text-neutral-100 focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40 px-2 py-1.5 leading-5"
            style={{ maxHeight, overflowY: "auto" }}
            value={(value as string) ?? ""}
            onCommit={(v) => onChange(v)}
          />
        );
      }
      return field.type === "long_text" ? (
        <DraftTextarea
          rows={1}
          className={cn(base, "bg-transparent outline-none resize-none text-neutral-800 dark:text-neutral-100 focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40 py-1.5")}
          value={(value as string) ?? ""}
          onCommit={(v) => onChange(v)}
        />
      ) : (
        <DraftInput
          className={cn(base, "bg-transparent outline-none text-neutral-800 dark:text-neutral-100 focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40")}
          value={(value as string) ?? ""}
          onCommit={(v) => onChange(v)}
          placeholder=""
        />
      );
    }
    case "email":
    case "phone":
    case "url":
      return (
        <DraftInput
          className={cn(base, "bg-transparent outline-none text-neutral-800 dark:text-neutral-100 focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40")}
          value={(value as string) ?? ""}
          onCommit={(v) => onChange(v)}
          placeholder=""
        />
      );
    case "number":
    case "integer":
      return (
        <DraftInput
          type="number"
          className={cn(base, "bg-transparent outline-none text-neutral-800 dark:text-neutral-100 focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40 tabular-nums")}
          value={value === null || value === undefined ? "" : (value as number)}
          onCommit={(v) => onChange(v === "" ? null : Number(v))}
        />
      );
    case "currency":
      return (
        <div className={cn(base, "gap-0.5")}>
          <span className="text-neutral-400">{config.currencySymbol ?? "$"}</span>
          <DraftInput
            type="number"
            className="flex-1 bg-transparent outline-none text-neutral-800 dark:text-neutral-100 tabular-nums focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40 h-full"
            value={value === null || value === undefined ? "" : (value as number)}
            onCommit={(v) => onChange(v === "" ? null : Number(v))}
          />
        </div>
      );
    case "percent":
      return (
        <div className={cn(base, "gap-0.5")}>
          <DraftInput
            type="number"
            className="flex-1 bg-transparent outline-none text-neutral-800 dark:text-neutral-100 tabular-nums focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40 h-full"
            value={value === null || value === undefined ? "" : (value as number)}
            onCommit={(v) => onChange(v === "" ? null : Number(v))}
          />
          <span className="text-neutral-400">%</span>
        </div>
      );
    case "duration": {
      const minutes = (value as number) ?? 0;
      return (
        <DraftInput
          type="number"
          className={cn(base, "bg-transparent outline-none text-neutral-800 dark:text-neutral-100 tabular-nums focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40")}
          value={minutes || ""}
          onCommit={(v) => onChange(v === "" ? null : Number(v))}
          placeholder="minutes"
          title={`${Math.floor(minutes / 60)}h ${minutes % 60}m`}
        />
      );
    }
    case "checkbox":
      return (
        <div className={cn(base, "justify-center")}>
          <Checkbox checked={!!value} onCheckedChange={(v) => onChange(v)} />
        </div>
      );
    case "date":
      return (
        <input
          type="date"
          className={cn(base, "bg-transparent outline-none text-neutral-800 dark:text-neutral-100 focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40")}
          value={value ? String(value).slice(0, 10) : ""}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "datetime":
      return (
        <input
          type="datetime-local"
          className={cn(base, "bg-transparent outline-none text-neutral-800 dark:text-neutral-100 focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40")}
          value={value ? String(value).slice(0, 16) : ""}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );
    case "single_select":
    case "status":
    case "importance":
    case "urgency": {
      const options = config.options ?? [];
      const selected = options.find((o) => o.id === value);
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(base, "gap-1 cursor-pointer")}>{selected ? <OptionBadge option={selected} /> : <span className="text-neutral-300">—</span>}</button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1">
            {options.map((o) => (
              <PopoverOption key={o.id} option={o} selected={o.id === value} onClick={() => onChange(o.id)} />
            ))}
            {value ? (
              <button onClick={() => onChange(null)} className="w-full text-left text-xs text-neutral-400 px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-sm mt-1">
                Clear
              </button>
            ) : null}
          </PopoverContent>
        </Popover>
      );
    }
    case "multi_select": {
      const options = config.options ?? [];
      const values: string[] = Array.isArray(value) ? (value as string[]) : [];
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(base, "gap-1 flex-wrap cursor-pointer overflow-hidden")}>
              {values.length ? (
                values.map((v) => {
                  const o = options.find((op) => op.id === v);
                  return o ? <OptionBadge key={v} option={o} /> : null;
                })
              ) : (
                <span className="text-neutral-300">—</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-48 p-1">
            {options.map((o) => (
              <PopoverOption
                key={o.id}
                option={o}
                selected={values.includes(o.id)}
                onClick={() => onChange(values.includes(o.id) ? values.filter((v) => v !== o.id) : [...values, o.id])}
              />
            ))}
          </PopoverContent>
        </Popover>
      );
    }
    case "rating": {
      const max = config.maxRating ?? 5;
      const rating = (value as number) ?? 0;
      return (
        <div className={cn(base, "gap-0.5")}>
          {Array.from({ length: max }).map((_, i) => (
            <button key={i} onClick={() => onChange(i + 1 === rating ? 0 : i + 1)}>
              <Star size={14} className={i < rating ? "fill-amber-400 text-amber-400" : "text-neutral-300 dark:text-neutral-700"} />
            </button>
          ))}
        </div>
      );
    }
    case "progress": {
      return <ProgressCell value={(value as number) ?? 0} className={base} onChange={onChange} />;
    }
    case "person":
    case "people": {
      const isMulti = field.type === "people";
      const values: string[] = isMulti ? (Array.isArray(value) ? (value as string[]) : []) : value ? [value as string] : [];
      const selectedMembers = members.filter((m) => values.includes(m.id));
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(base, "gap-1 cursor-pointer overflow-hidden")}>
              {selectedMembers.length ? (
                selectedMembers.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 dark:bg-neutral-800 pl-0.5 pr-2 py-0.5 text-xs">
                    <span className="h-4 w-4 rounded-full flex items-center justify-center text-white text-[9px]" style={{ backgroundColor: m.avatarColor }}>
                      {initials(m.name)}
                    </span>
                    {m.name}
                  </span>
                ))
              ) : (
                <UserIcon size={13} className="text-neutral-300" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-1">
            {members.map((m) => (
              <button
                key={m.id}
                onClick={() => {
                  if (isMulti) onChange(values.includes(m.id) ? values.filter((v) => v !== m.id) : [...values, m.id]);
                  else onChange(value === m.id ? null : m.id);
                }}
                className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm"
              >
                <span className="h-5 w-5 rounded-full flex items-center justify-center text-white text-[10px]" style={{ backgroundColor: m.avatarColor }}>
                  {initials(m.name)}
                </span>
                <span className="flex-1 text-left truncate">{m.name}</span>
                {values.includes(m.id) && <Check size={13} className="text-indigo-600" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      );
    }
    case "link": {
      const values: string[] = Array.isArray(value) ? (value as string[]) : [];
      const target = linkTargets?.[field.id];
      const labels = values.map((id) => target?.records.find((r) => r.id === id)?.label ?? "…");
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(base, "gap-1 cursor-pointer overflow-hidden")}>
              {labels.length ? (
                labels.map((l, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 text-xs truncate max-w-[100px]">
                    <Link2 size={10} /> {l}
                  </span>
                ))
              ) : (
                <span className="text-neutral-300">—</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1 max-h-64 overflow-y-auto thin-scroll">
            {!target && <div className="text-xs text-neutral-400 px-2 py-2">No linked table configured</div>}
            {target?.records.map((r) => (
              <button
                key={r.id}
                onClick={() => onChange(values.includes(r.id) ? values.filter((v) => v !== r.id) : [...values, r.id])}
                className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm text-left"
              >
                <span className="flex-1 truncate">{r.label}</span>
                {values.includes(r.id) && <Check size={13} className="text-indigo-600" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      );
    }
    case "okr_target": {
      const objectives = config.objectives ?? [];
      const selected = resolveOkrTarget(config, value);
      const pick = (token: string) => onChange(token === value ? null : token);
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(base, "gap-1 cursor-pointer overflow-hidden")}>
              {selected ? (
                selected.kind === "kr" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 px-2 py-0.5 text-xs truncate max-w-full" title={`${selected.objectiveTitle} › ${selected.title}`}>
                    <KeySquare size={10} className="shrink-0" /> <span className="truncate">{selected.title}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 text-xs truncate max-w-full">
                    <Target size={10} className="shrink-0" /> <span className="truncate">{selected.title}</span>
                  </span>
                )
              ) : (
                <span className="text-neutral-300">—</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-1 max-h-80 overflow-y-auto thin-scroll">
            {objectives.map((o) => (
              <div key={o.id} className="mb-1">
                <button
                  onClick={() => pick(`obj:${o.id}`)}
                  className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm text-left font-medium"
                >
                  <Target size={12} className="text-indigo-500 shrink-0" />
                  <span className="flex-1 truncate">{o.title}</span>
                  {value === `obj:${o.id}` && <Check size={13} className="text-indigo-600" />}
                </button>
                {o.keyResults.map((k) => (
                  <button
                    key={k.id}
                    onClick={() => pick(`kr:${k.id}`)}
                    className="w-full flex items-center gap-2 rounded-sm pl-6 pr-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm text-left"
                  >
                    <KeySquare size={11} className="text-teal-500 shrink-0" />
                    <span className="flex-1 truncate">{k.title}</span>
                    {value === `kr:${k.id}` && <Check size={13} className="text-indigo-600" />}
                  </button>
                ))}
              </div>
            ))}
          </PopoverContent>
        </Popover>
      );
    }
    case "task_attachments": {
      const files = Array.isArray(value) ? (value as CellFile[]) : [];
      return <AttachmentsCell taskId={record.id} files={files} className={base} onChange={onChange} />;
    }
    case "okr_objective": {
      const objectives = okrOptions?.objectives ?? [];
      const selected = objectives.find((o) => o.id === value);
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(base, "gap-1 cursor-pointer overflow-hidden")}>
              {selected ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 text-xs truncate max-w-full">
                  <Target size={10} className="shrink-0" /> <span className="truncate">{selected.title}</span>
                </span>
              ) : (
                <span className="text-neutral-300">—</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1 max-h-64 overflow-y-auto thin-scroll">
            {objectives.length === 0 && <div className="text-xs text-neutral-400 px-2 py-2">No Objectives yet - create one from the OKRs section</div>}
            {objectives.map((o) => (
              <button
                key={o.id}
                onClick={() => onChange(o.id === value ? null : o.id)}
                className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm text-left"
              >
                <span className="flex-1 truncate">{o.title}</span>
                {o.id === value && <Check size={13} className="text-indigo-600" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      );
    }
    case "okr_key_result": {
      const keyResults = okrOptions?.keyResults ?? [];
      const objectives = okrOptions?.objectives ?? [];
      const selected = keyResults.find((k) => k.id === value);
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(base, "gap-1 cursor-pointer overflow-hidden")}>
              {selected ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 px-2 py-0.5 text-xs truncate max-w-full">
                  <KeySquare size={10} className="shrink-0" /> <span className="truncate">{selected.title}</span>
                </span>
              ) : (
                <span className="text-neutral-300">—</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-1 max-h-72 overflow-y-auto thin-scroll">
            {keyResults.length === 0 && <div className="text-xs text-neutral-400 px-2 py-2">No Key Results yet - add one under an Objective</div>}
            {objectives.map((o) => {
              const krs = keyResults.filter((k) => k.objectiveId === o.id);
              if (!krs.length) return null;
              return (
                <div key={o.id} className="mb-1">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400 truncate">{o.title}</div>
                  {krs.map((k) => (
                    <button
                      key={k.id}
                      onClick={() => onChange(k.id === value ? null : k.id)}
                      className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm text-left"
                    >
                      <span className="flex-1 truncate">{k.title}</span>
                      {k.id === value && <Check size={13} className="text-indigo-600" />}
                    </button>
                  ))}
                </div>
              );
            })}
          </PopoverContent>
        </Popover>
      );
    }
    case "attachment": {
      const files: AttachmentValue[] = Array.isArray(value) ? (value as AttachmentValue[]) : [];
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(base, "gap-1 cursor-pointer overflow-hidden")}>
              {files.length ? (
                files.map((f) => (
                  <span key={f.id} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-xs truncate max-w-[100px]">
                    <Paperclip size={10} className="shrink-0" /> {f.name}
                  </span>
                ))
              ) : (
                <Paperclip size={13} className="text-neutral-300" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2">
            <AttachmentEditor files={files} onChange={onChange} />
          </PopoverContent>
        </Popover>
      );
    }
    case "formula":
      return <div className={cn(base, "text-neutral-500 dark:text-neutral-400 italic truncate")}>{value === null || value === undefined ? "" : String(value)}</div>;
    case "created_time":
    case "modified_time":
      return <div className={cn(base, "text-neutral-400 tabular-nums")}>{formatDate(value as string, true)}</div>;
    case "created_by": {
      const m = members.find((mm) => mm.id === value);
      return <div className={cn(base, "text-neutral-500")}>{m?.name ?? ""}</div>;
    }
    case "auto_number":
      return <div className={cn(base, "text-neutral-400 tabular-nums")}>{value as number}</div>;
    default:
      return <div className={base}>{String(value ?? "")}</div>;
  }
}

function AttachmentEditor({ files, onChange }: { files: AttachmentValue[]; onChange: (v: AttachmentValue[]) => void }) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  function add() {
    if (!url.trim()) return;
    onChange([...files, { id: `${Date.now()}`, name: name.trim() || url.trim(), url: url.trim() }]);
    setName("");
    setUrl("");
  }

  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <div className="space-y-1 max-h-32 overflow-y-auto thin-scroll">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-1.5 text-sm">
              <Paperclip size={12} className="text-neutral-400 shrink-0" />
              <a href={f.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-indigo-600 hover:underline">
                {f.name}
              </a>
              <button onClick={() => onChange(files.filter((x) => x.id !== f.id))} className="text-neutral-400 hover:text-red-600 shrink-0">
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="space-y-1.5 pt-1 border-t border-neutral-100 dark:border-neutral-800">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="File name (optional)" className="h-7" />
        <div className="flex gap-1.5">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="h-7 flex-1" onKeyDown={(e) => e.key === "Enter" && add()} />
          <Button size="icon" onClick={add} disabled={!url.trim()}>
            <Plus size={13} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function PopoverOption({ option, selected, onClick }: { option: SelectOption; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
      <OptionBadge option={option} />
      <span className="flex-1" />
      {selected && <Check size={13} className="text-indigo-600" />}
    </button>
  );
}

export function CellDisplayValue(field: FieldRow, value: unknown): string {
  const config = parseFieldConfig(field.config);
  if (SELECT_SINGLE_TYPES.includes(field.type)) {
    return config.options?.find((o) => o.id === value)?.label ?? "";
  }
  if (field.type === "multi_select" && Array.isArray(value)) {
    return value.map((v) => config.options?.find((o) => o.id === v)?.label ?? "").join(", ");
  }
  if (field.type === "attachment" && Array.isArray(value)) {
    return (value as AttachmentValue[]).map((a) => a.name).join(", ");
  }
  if (field.type === "okr_target") {
    const t = resolveOkrTarget(config, value);
    return t ? (t.kind === "kr" ? `${t.objectiveTitle} › ${t.title}` : t.title) : "";
  }
  if (field.type === "task_attachments" && Array.isArray(value)) {
    return value.length ? `📎 ${value.length}` : "";
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return value === null || value === undefined ? "" : String(value);
}
