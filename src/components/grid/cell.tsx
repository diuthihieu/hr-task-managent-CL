"use client";
import { DateInput } from "@/components/ui/date-input";
import { Star, User as UserIcon, Check, Paperclip, Target, KeySquare, MapPin, ExternalLink } from "lucide-react";
import { Checkbox } from "@/components/ui/misc";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { getFieldType, parseFieldConfig, resolveOkrTarget, type AttachmentValue } from "@/lib/field-types";
import { cn, initials, formatDate } from "@/lib/utils";
import type { FieldRow, RecordRow } from "@/types";
import { AttachmentsCell, type CellFile } from "./attachments-cell";
import { AvatarImg } from "@/components/ui/avatar-img";
import { Barcode, JsonInput, LocationInput, SignatureInput, SignaturePreview } from "@/components/fields/advanced-field-inputs";
import type { LinkTarget, Member, OkrOptions } from "./cell-types";
import { DraftInput, DraftTextarea, OptionBadge, PopoverOption, ProgressCell } from "./cell-inputs";
import { AttachmentEditor, ComputedFieldCell, LinkCell, safeButtonUrl } from "./cell-special";
import { CellDisplayValue, PeopleChips, readOnlyText } from "./cell-display";

export type { Member, LinkTarget, OkrOptions } from "./cell-types";
export { CellDisplayValue } from "./cell-display";

interface CellProps {
  field: FieldRow;
  value: unknown;
  record: RecordRow;
  members: Member[];
  linkTargets?: Record<string, LinkTarget>; // keyed by field.id, for `link` fields
  okrOptions?: OkrOptions; // for `okr_objective` / `okr_key_result` fields
  onChange: (value: unknown) => void;
  readOnlyOverride?: boolean;
  /** Wrap text and grow the containing row/field to show its full content. */
  wrapText?: boolean;
  columnWidth?: number;
}

export function Cell({ field, value, record, members, linkTargets, okrOptions, wrapText, onChange, readOnlyOverride }: CellProps) {
  const typeDef = getFieldType(field.type);
  const config = parseFieldConfig(field.config);
  const base = "h-full w-full flex items-center px-2 text-sm";

  if (readOnlyOverride) {
    const showFullText = wrapText && (field.type === "text" || field.type === "long_text");
    return <div className={cn(base, "text-neutral-700 dark:text-neutral-300", showFullText ? "h-auto min-h-[32px] items-start whitespace-pre-wrap break-words py-1.5" : "truncate")}>{readOnlyText(field, value, members, linkTargets, okrOptions) || <span className="text-neutral-300">—</span>}</div>;
  }

  if (typeDef.comingSoon) {
    return <div className={cn(base, "text-neutral-300 dark:text-neutral-700")}>—</div>;
  }

  switch (field.type) {
    case "text":
    case "long_text": {
      if (wrapText) {
        return (
          <DraftTextarea
            autoGrow
            className="block w-full bg-transparent outline-none resize-none text-sm text-neutral-800 dark:text-neutral-100 focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40 px-2 py-1.5 leading-5 break-words"
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
        <DateInput
          className={cn(base, "bg-transparent outline-none text-neutral-800 dark:text-neutral-100 focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40")}
          value={value ? String(value).slice(0, 10) : ""}
          onCommit={onChange}
        />
      );
    case "datetime":
      return (
        <DateInput
          type="datetime-local"
          className={cn(base, "bg-transparent outline-none text-neutral-800 dark:text-neutral-100 focus:bg-indigo-50/60 dark:focus:bg-indigo-950/40")}
          value={value ? String(value).slice(0, 16) : ""}
          onCommit={(v) => onChange(v ? new Date(v).toISOString() : null)}
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
            <button className={cn(base, "cursor-pointer overflow-hidden", wrapText && "py-1")}>
              {selectedMembers.length ? <PeopleChips people={selectedMembers} wrap={!!wrapText} /> : <UserIcon size={13} className="text-neutral-300" />}
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
                <span className="relative overflow-hidden h-5 w-5 rounded-full flex items-center justify-center text-white text-[10px]" style={{ backgroundColor: m.avatarColor }}>
                  {initials(m.name)}
                  <AvatarImg id={m.id} />
                </span>
                <span className="flex-1 text-left truncate">{m.name}</span>
                {values.includes(m.id) && <Check size={13} className="text-indigo-600" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      );
    }
    case "team": {
      const teams = config.teams ?? [];
      const selected = teams.find((team) => team.id === value);
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button className={cn(base, "gap-1 cursor-pointer overflow-hidden")}>
              {selected ? <span className="rounded-full px-2 py-0.5 text-xs" style={{ color: selected.color, backgroundColor: `${selected.color}22` }}>{selected.name}</span> : <span className="text-neutral-300">—</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-52 p-1">
            {teams.map((team) => (
              <button key={team.id} onClick={() => onChange(team.id === value ? null : team.id)} className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm">
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: team.color }} /><span className="flex-1 text-left truncate">{team.name}</span>{team.id === value && <Check size={13} className="text-indigo-600" />}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      );
    }
    case "location": {
      const location = value && typeof value === "object" ? (value as { address?: string; lat?: number; lng?: number }) : {};
      const label = location.address || (location.lat !== undefined && location.lng !== undefined ? `${location.lat}, ${location.lng}` : "");
      return (
        <Popover>
          <PopoverTrigger asChild><button className={cn(base, "gap-1 cursor-pointer truncate")}>{label ? <><MapPin size={13} className="shrink-0 text-indigo-500" /><span className="truncate">{label}</span></> : <span className="text-neutral-300">—</span>}</button></PopoverTrigger>
          <PopoverContent className="w-80 p-3"><LocationInput value={value} onChange={onChange} /></PopoverContent>
        </Popover>
      );
    }
    case "signature":
      return (
        <Popover>
          <PopoverTrigger asChild><button className={cn(base, "cursor-pointer overflow-hidden")}><SignaturePreview value={value} /></button></PopoverTrigger>
          <PopoverContent className="w-96 p-3"><SignatureInput value={value} onChange={onChange} /></PopoverContent>
        </Popover>
      );
    case "link":
      return <LinkCell field={field} config={config} value={value} recordId={record.id} target={linkTargets?.[field.id]} base={base} onChange={onChange} />;
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
    case "lookup":
    case "rollup":
      return <div className={cn(base, "text-neutral-500 dark:text-neutral-400 italic truncate")}>{value === null || value === undefined ? "" : String(value)}</div>;
    case "button": {
      const href = safeButtonUrl(config.buttonUrlTemplate, record.id);
      return href ? <div className={base}><a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700">{config.buttonLabel || "Open"}<ExternalLink size={11} /></a></div> : <div className={cn(base, "text-neutral-300")}>—</div>;
    }
    case "barcode":
      return (
        <Popover>
          <PopoverTrigger asChild><button className={cn(base, "cursor-pointer overflow-hidden p-1")}><Barcode value={value} /></button></PopoverTrigger>
          <PopoverContent className="w-80 p-3 space-y-2"><Barcode value={value} /><Input value={String(value ?? "")} maxLength={200} onChange={(e) => onChange(e.target.value)} /></PopoverContent>
        </Popover>
      );
    case "json":
      return (
        <Popover>
          <PopoverTrigger asChild><button className={cn(base, "font-mono text-xs cursor-pointer truncate text-left")}>{CellDisplayValue(field, value) || <span className="text-neutral-300">—</span>}</button></PopoverTrigger>
          <PopoverContent className="w-[28rem] p-3"><JsonInput value={value} onChange={onChange} /></PopoverContent>
        </Popover>
      );
    case "ai_field":
    case "api_result":
      return <ComputedFieldCell field={field} recordId={record.id} initialValue={value} base={base} />;
    case "created_time":
    case "modified_time":
      return <div className={cn(base, "text-neutral-400 tabular-nums")}>{formatDate(value as string, true)}</div>;
    case "created_by":
    case "modified_by": {
      const m = members.find((mm) => mm.id === value);
      return <div className={cn(base, "text-neutral-500")}>{m?.name ?? ""}</div>;
    }
    case "auto_number":
      return <div className={cn(base, "text-neutral-400 tabular-nums")}>{value as number}</div>;
    default:
      return <div className={base}>{String(value ?? "")}</div>;
  }
}

