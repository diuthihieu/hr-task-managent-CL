"use client";
// Read-only rendering of a cell value: text for exports and read-only cells, and people chips.
import { useLayoutEffect, useRef, useState } from "react";
import { parseFieldConfig, resolveOkrTarget, SELECT_SINGLE_TYPES, type AttachmentValue } from "@/lib/field-types";
import { cn, initials, formatDate } from "@/lib/utils";
import type { FieldRow } from "@/types";
import { AvatarImg } from "@/components/ui/avatar-img";
import type { LinkTarget, Member, OkrOptions } from "./cell-types";

/** Read-only text for a cell: names instead of member / task / OKR ids, and readable dates. */
export function readOnlyText(field: FieldRow, value: unknown, members: Member[], linkTargets?: Record<string, LinkTarget>, okrOptions?: OkrOptions): string {
  const ids = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
  switch (field.type) {
    case "created_time":
    case "modified_time":
    case "datetime":
      return formatDate(value as string, true);
    case "date": {
      const m = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
      return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
    }
    case "person":
    case "people":
    case "created_by":
    case "modified_by":
      return ids.map((id) => members.find((m) => m.id === id)?.name ?? "").filter(Boolean).join(", ");
    case "link":
      return ids.map((id) => linkTargets?.[field.id]?.records.find((r) => r.id === id)?.label ?? "").filter(Boolean).join(", ");
    case "okr_objective":
      return okrOptions?.objectives.find((o) => o.id === value)?.title ?? "";
    case "okr_key_result":
      return okrOptions?.keyResults.find((k) => k.id === value)?.title ?? "";
    default:
      return CellDisplayValue(field, value);
  }
}

export function CellDisplayValue(field: FieldRow, value: unknown): string {
  const config = parseFieldConfig(field.config);
  if (SELECT_SINGLE_TYPES.includes(field.type)) {
    return config.options?.find((o) => o.id === value)?.label ?? "";
  }
  if (field.type === "multi_select" && Array.isArray(value)) {
    return value.map((v) => config.options?.find((o) => o.id === v)?.label ?? "").join(", ");
  }
  if (field.type === "team") return config.teams?.find((team) => team.id === value)?.name ?? "";
  if (field.type === "location" && value && typeof value === "object") {
    const location = value as { address?: string; lat?: number; lng?: number };
    return location.address || (location.lat !== undefined && location.lng !== undefined ? `${location.lat}, ${location.lng}` : "");
  }
  if (field.type === "signature") return value ? "Signed" : "";
  if (field.type === "json" || field.type === "api_result") return value === null || value === undefined ? "" : JSON.stringify(value);
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

/**
 * Assignee chips keep each name whole. With wrapping on they flow onto new
 * lines; otherwise the chips that don't fit collapse into a "+N" chip (names in
 * its tooltip) instead of squeezing or covering each other.
 */
export function PeopleChips({ people, wrap }: { people: { id: string; name: string; avatarColor: string }[]; wrap: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState(people.length);
  const key = people.map((p) => p.id).join(",");
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || wrap) return;
    const measure = () => {
      const chips = [...el.querySelectorAll<HTMLElement>("[data-chip]")];
      // Widths, not positions: chips already collapsed into "+N" are out of the flow.
      const GAP = 4;
      let used = 0;
      let n = 0;
      for (const [i, c] of chips.entries()) {
        const next = used + (i ? GAP : 0) + c.offsetWidth;
        const room = i === chips.length - 1 ? el.clientWidth : el.clientWidth - 34; // keep space for "+N"
        if (next > room) break;
        used = next;
        n++;
      }
      setFit(Math.max(1, n));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [key, wrap]);
  const hidden = wrap ? [] : people.slice(fit);
  return (
    <span ref={ref} className={cn("relative flex min-w-0 w-full gap-1", wrap ? "flex-wrap" : "flex-nowrap overflow-hidden")}>
      {people.map((m, i) => (
        <span
          key={m.id}
          data-chip
          title={m.name}
          className={cn("inline-flex items-center gap-1 rounded-full bg-neutral-100 dark:bg-neutral-800 pl-0.5 pr-2 py-0.5 text-xs whitespace-nowrap shrink-0 max-w-full", !wrap && i >= fit && "invisible absolute")}
        >
          <span className="relative overflow-hidden h-4 w-4 rounded-full flex items-center justify-center text-white text-[9px] shrink-0" style={{ backgroundColor: m.avatarColor }}>
            {initials(m.name)}
            <AvatarImg id={m.id} />
          </span>
          <span className="truncate">{m.name}</span>
        </span>
      ))}
      {hidden.length > 0 && (
        <span className="inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.5 text-[11px] font-medium shrink-0" title={hidden.map((h) => h.name).join(", ")} data-testid="people-more">
          +{hidden.length}
        </span>
      )}
    </span>
  );
}
