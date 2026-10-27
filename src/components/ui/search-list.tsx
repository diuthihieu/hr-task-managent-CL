"use client";
import { useMemo, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

export interface SearchItem {
  value: string;
  label: string;
}

/** Lower-case, accents removed ("Đào tạo" -> "dao tao"), so Vietnamese names match without diacritics. */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

const MAX_SHOWN = 200;

/** A search box over a list: type to narrow it (accents optional), Enter picks the first match. */
export function SearchList({
  items,
  selected = [],
  onPick,
  placeholder,
  emptyText,
  testId,
}: {
  items: SearchItem[];
  selected?: string[];
  onPick: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  testId?: string;
}) {
  const { t } = useT();
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const needle = foldText(q.trim());
    const hits = needle ? items.filter((i) => foldText(i.label).includes(needle)) : items;
    return hits.slice(0, MAX_SHOWN);
  }, [items, q]);
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-neutral-100 px-2 pb-1.5 dark:border-neutral-800">
        <Search size={13} className="shrink-0 text-neutral-400" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) {
              e.preventDefault();
              onPick(shown[0].value);
            }
          }}
          placeholder={placeholder ?? t("common.search")}
          className="h-7 w-full bg-transparent text-sm outline-none"
          data-testid={testId ? `${testId}-search` : undefined}
        />
      </div>
      <div className="mt-1 max-h-64 overflow-y-auto thin-scroll" role="listbox" data-testid={testId ? `${testId}-list` : undefined}>
        {shown.length === 0 ? <div className="px-2 py-2 text-xs text-neutral-400">{emptyText ?? t("common.noResults")}</div> : null}
        {shown.map((item) => (
          <button
            key={item.value}
            type="button"
            role="option"
            aria-selected={selected.includes(item.value)}
            onClick={() => onPick(item.value)}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <span className="flex-1 break-words">{item.label}</span>
            {selected.includes(item.value) ? <Check size={13} className="shrink-0 text-indigo-600" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A button that opens a searchable list and closes after a pick. */
export function SearchPicker({
  items,
  onPick,
  label,
  placeholder,
  className,
  testId,
}: {
  items: SearchItem[];
  onPick: (value: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn("flex h-8 w-full items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-2 text-left text-xs text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300", className)}
          data-testid={testId}
        >
          <span className="truncate">{label}</span>
          <ChevronDown size={13} className="shrink-0 text-neutral-400" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-24px))] p-1.5 pt-2">
        <SearchList
          items={items}
          placeholder={placeholder}
          testId={testId}
          onPick={(v) => {
            setOpen(false);
            onPick(v);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
