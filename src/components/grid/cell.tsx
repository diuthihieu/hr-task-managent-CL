"use client";
import { useState } from "react";
import { Star, User as UserIcon, Link2, Check, Paperclip, Plus, X } from "lucide-react";
import { Checkbox } from "@/components/ui/misc";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getFieldType, parseFieldConfig, type SelectOption, type AttachmentValue } from "@/lib/field-types";
import { cn, initials, formatDate } from "@/lib/utils";
import type { FieldRow, RecordRow } from "@/types";

export interface Member {
  id: string;
  name: string;
  avatarColor: string;
}

export interface LinkTarget {
  records: { id: string; label: string }[];
}

interface CellProps {
  field: FieldRow;
  value: unknown;
  record: RecordRow;
  members: Member[];
  linkTargets?: Record<string, LinkTarget>; // keyed by field.id, for `link` fields
  onChange: (value: unknown) => void;
  readOnlyOverride?: boolean;
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

export function Cell({ field, value, members, linkTargets, onChange }: CellProps) {
  const typeDef = getFieldType(field.type);
  const config = parseFieldConfig(field.config);
  const base = "h-full w-full flex items-center px-2 text-sm";

  if (typeDef.comingSoon) {
    return <div className={cn(base, "text-neutral-300 dark:text-neutral-700")}>—</div>;
  }

  switch (field.type) {
    case "text":
    case "email":
    case "phone":
    case "url":
      return (
        <input
          className={cn(base, "bg-transparent outline-none text-neutral-800 dark:text-neutral-100 focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40")}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder=""
        />
      );
    case "long_text":
      return (
        <textarea
          rows={1}
          className={cn(base, "bg-transparent outline-none resize-none text-neutral-800 dark:text-neutral-100 focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40 py-1.5")}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
    case "integer":
      return (
        <input
          type="number"
          className={cn(base, "bg-transparent outline-none text-neutral-800 dark:text-neutral-100 focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40 tabular-nums")}
          value={value === null || value === undefined ? "" : (value as number)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    case "currency":
      return (
        <div className={cn(base, "gap-0.5")}>
          <span className="text-neutral-400">{config.currencySymbol ?? "$"}</span>
          <input
            type="number"
            className="flex-1 bg-transparent outline-none text-neutral-800 dark:text-neutral-100 tabular-nums focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40 h-full"
            value={value === null || value === undefined ? "" : (value as number)}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
        </div>
      );
    case "percent":
      return (
        <div className={cn(base, "gap-0.5")}>
          <input
            type="number"
            className="flex-1 bg-transparent outline-none text-neutral-800 dark:text-neutral-100 tabular-nums focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40 h-full"
            value={value === null || value === undefined ? "" : (value as number)}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
          <span className="text-neutral-400">%</span>
        </div>
      );
    case "duration": {
      const minutes = (value as number) ?? 0;
      return (
        <input
          type="number"
          className={cn(base, "bg-transparent outline-none text-neutral-800 dark:text-neutral-100 tabular-nums focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40")}
          value={minutes || ""}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
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
    case "status": {
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
      const pct = Math.max(0, Math.min(100, (value as number) ?? 0));
      return (
        <div className={cn(base, "gap-2")}>
          <div className="flex-1 h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
            <div className="h-full bg-indigo-500" style={{ width: `${pct}%` }} />
          </div>
          <input
            type="number"
            min={0}
            max={100}
            className="w-10 bg-transparent outline-none text-xs text-neutral-500 tabular-nums"
            value={pct}
            onChange={(e) => onChange(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
          />
        </div>
      );
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
  if (["single_select", "status"].includes(field.type)) {
    return config.options?.find((o) => o.id === value)?.label ?? "";
  }
  if (field.type === "multi_select" && Array.isArray(value)) {
    return value.map((v) => config.options?.find((o) => o.id === v)?.label ?? "").join(", ");
  }
  if (field.type === "attachment" && Array.isArray(value)) {
    return (value as AttachmentValue[]).map((a) => a.name).join(", ");
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return value === null || value === undefined ? "" : String(value);
}
