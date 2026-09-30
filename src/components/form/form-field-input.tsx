"use client";
import { Star, Check, User as UserIcon } from "lucide-react";
import { Input, Textarea } from "@/components/ui/input";
import { Checkbox, Select } from "@/components/ui/misc";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { parseFieldConfig } from "@/lib/field-types";
import { initials, cn } from "@/lib/utils";
import type { FieldRow } from "@/types";
import { useT } from "@/components/i18n-provider";
import { AvatarImg } from "@/components/ui/avatar-img";

export interface FormMember {
  id: string;
  name: string;
  avatarColor: string;
}

// A separate renderer from grid/cell.tsx's <Cell>: forms fill in a *new*
// record that doesn't exist yet (no id, no linked-record context), and need
// labeled, full-width, validation-aware inputs instead of a spreadsheet
// cell's compact inline editor - the two are shaped for different jobs even
// though they cover the same field types.
export function FormFieldInput({
  field,
  value,
  members,
  onChange,
}: {
  field: FieldRow;
  value: unknown;
  members: FormMember[];
  onChange: (value: unknown) => void;
}) {
  const { t } = useT();
  const config = parseFieldConfig(field.config);

  switch (field.type) {
    case "long_text":
      return <Textarea rows={3} value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "email":
      return <Input type="email" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="name@example.com" />;
    case "phone":
      return <Input type="tel" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
    case "url":
      return <Input type="url" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="https://…" />;
    case "number":
    case "integer":
    case "duration":
      return <Input type="number" value={value === null || value === undefined ? "" : (value as number)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />;
    case "currency":
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-neutral-400">{config.currencySymbol ?? "$"}</span>
          <Input type="number" value={value === null || value === undefined ? "" : (value as number)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
        </div>
      );
    case "percent":
    case "progress":
      return (
        <div className="flex items-center gap-1.5">
          <Input type="number" min={0} max={field.type === "progress" ? 100 : undefined} value={value === null || value === undefined ? "" : (value as number)} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
          <span className="text-neutral-400">%</span>
        </div>
      );
    case "checkbox":
      return <Checkbox checked={!!value} onCheckedChange={onChange} />;
    case "date":
      return <Input type="date" value={value ? String(value).slice(0, 10) : ""} onChange={(e) => onChange(e.target.value || null)} />;
    case "datetime":
      return (
        <Input
          type="datetime-local"
          value={value ? String(value).slice(0, 16) : ""}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );
    case "single_select":
    case "status":
    case "importance":
    case "urgency":
      return (
        <Select
          className="w-full"
          value={(value as string) ?? ""}
          onValueChange={onChange}
          options={(config.options ?? []).map((o) => ({ value: o.id, label: o.label }))}
          placeholder={t("form.choose")}
        />
      );
    case "multi_select": {
      const values: string[] = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-1.5">
          {(config.options ?? []).map((o) => {
            const selected = values.includes(o.id);
            return (
              <button
                type="button"
                key={o.id}
                onClick={() => onChange(selected ? values.filter((v) => v !== o.id) : [...values, o.id])}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border",
                  selected ? "border-transparent text-white" : "border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300"
                )}
                style={selected ? { backgroundColor: o.color } : undefined}
              >
                {selected && <Check size={11} />}
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    case "rating": {
      const max = config.maxRating ?? 5;
      const rating = (value as number) ?? 0;
      return (
        <div className="flex items-center gap-1">
          {Array.from({ length: max }).map((_, i) => (
            <button type="button" key={i} onClick={() => onChange(i + 1 === rating ? 0 : i + 1)}>
              <Star size={20} className={i < rating ? "fill-amber-400 text-amber-400" : "text-neutral-300 dark:text-neutral-700"} />
            </button>
          ))}
        </div>
      );
    }
    case "person":
    case "people": {
      const isMulti = field.type === "people";
      const values: string[] = isMulti ? (Array.isArray(value) ? value : []) : value ? [value as string] : [];
      const selected = members.filter((m) => values.includes(m.id));
      return (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="flex items-center gap-1.5 h-9 w-full rounded-md border border-neutral-300 dark:border-neutral-700 px-2.5 text-sm text-left">
              {selected.length ? (
                selected.map((m) => (
                  <span key={m.id} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 dark:bg-neutral-800 pl-0.5 pr-2 py-0.5 text-xs">
                    <span className="relative overflow-hidden h-4 w-4 rounded-full flex items-center justify-center text-white text-[9px]" style={{ backgroundColor: m.avatarColor }}>
                      {initials(m.name)}
                      <AvatarImg id={m.id} />
                    </span>
                    {m.name}
                  </span>
                ))
              ) : (
                <span className="flex items-center gap-1.5 text-neutral-400">
                  <UserIcon size={14} /> {t("form.choose")}
                </span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1">
            {members.map((m) => (
              <button
                type="button"
                key={m.id}
                onClick={() => (isMulti ? onChange(values.includes(m.id) ? values.filter((v) => v !== m.id) : [...values, m.id]) : onChange(value === m.id ? null : m.id))}
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
    case "attachment": {
      const files: { id: string; name: string; url: string }[] = Array.isArray(value) ? value : [];
      return (
        <div className="space-y-1.5">
          {files.map((f) => (
            <div key={f.id} className="flex items-center gap-1.5 text-sm">
              <a href={f.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline truncate">
                {f.name}
              </a>
              <button type="button" onClick={() => onChange(files.filter((x) => x.id !== f.id))} className="text-neutral-400 hover:text-red-600">
                ×
              </button>
            </div>
          ))}
          <Input
            placeholder={t("form.fileUrl")}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.currentTarget.value.trim()) {
                onChange([...files, { id: `${Date.now()}`, name: e.currentTarget.value.trim(), url: e.currentTarget.value.trim() }]);
                e.currentTarget.value = "";
              }
            }}
          />
        </div>
      );
    }
    default:
      return <Input value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
}
