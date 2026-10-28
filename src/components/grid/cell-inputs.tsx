"use client";
// Small inputs used inside cells: draft text / number inputs, the progress slider and option badges.
import { useLayoutEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { type SelectOption } from "@/lib/field-types";
import { cn } from "@/lib/utils";

// Text-like cells keep a local draft and only commit on blur / Enter, so the
// server sees one update per edit (one activity-log entry, one validation)
// instead of one request per keystroke.
export type DraftProps<T extends HTMLInputElement | HTMLTextAreaElement> = Omit<React.InputHTMLAttributes<T> & React.TextareaHTMLAttributes<T>, "value" | "onChange"> & {
  value: string | number;
  onCommit: (raw: string) => void;
};

export function useDraft(value: string | number, onCommit: (raw: string) => void) {
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

export function DraftInput({ value, onCommit, ...rest }: DraftProps<HTMLInputElement>) {
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

/**
 * With `autoGrow`, the textarea is sized to its real content height (measured,
 * not estimated): re-measured on every edit and whenever its width changes
 * (column resize, sidebar toggle).
 */
export function DraftTextarea({ value, onCommit, autoGrow, ...rest }: DraftProps<HTMLTextAreaElement> & { autoGrow?: boolean }) {
  const d = useDraft(value, onCommit);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!autoGrow || !el) return;
    const fit = () => {
      el.style.height = "auto";
      const h = el.scrollHeight;
      el.style.height = `${h}px`;
      el.style.overflowY = "hidden";
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(el.parentElement ?? el);
    return () => ro?.disconnect();
  }, [autoGrow, d.draft]);
  return (
    <textarea
      {...(rest as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
      ref={ref}
      rows={autoGrow ? 1 : rest.rows}
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
export function ProgressCell({ value, className, onChange }: { value: number; className: string; onChange: (v: number) => void }) {
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

export function OptionBadge({ option }: { option: SelectOption }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium truncate max-w-full"
      style={{ backgroundColor: `${option.color}22`, color: option.color }}
    >
      {option.label}
    </span>
  );
}

export function PopoverOption({ option, selected, onClick }: { option: SelectOption; selected: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
      <OptionBadge option={option} />
      <span className="flex-1" />
      {selected && <Check size={13} className="text-indigo-600" />}
    </button>
  );
}
