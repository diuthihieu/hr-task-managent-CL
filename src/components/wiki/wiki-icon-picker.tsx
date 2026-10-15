"use client";
import { useState } from "react";
import { BookOpen, Ban, Check } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

// A curated set for HR / team knowledge spaces; any other emoji can be typed or pasted.
const EMOJI = [
  "📘", "📗", "📕", "📙", "📚", "📖", "📝", "📋", "📌", "📎", "🗂️", "📁",
  "👥", "🤝", "🧑‍💼", "👩‍💻", "🎓", "🏫", "🧠", "💡", "🎯", "🚀", "🏆", "⭐",
  "💰", "💳", "🧾", "📊", "📈", "🗓️", "⏰", "✅", "⚖️", "🛡️", "🔒", "🏥",
  "🏢", "🌏", "📣", "💬", "🛠️", "⚙️", "💻", "📦", "🌱", "❤️", "☕", "🎉",
];

/** First user-perceived character (one emoji, even a multi-codepoint one). */
function firstGrapheme(v: string): string {
  const s = v.trim();
  if (!s) return "";
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) for (const part of new Seg(undefined, { granularity: "grapheme" }).segment(s)) return part.segment.slice(0, 16);
  return Array.from(s)[0] ?? "";
}

/** Wiki icon: pick an emoji from the grid, type/paste any emoji, or none (book icon). */
export function WikiIconPicker({ value, onChange, disabled }: { value: string; onChange: (icon: string) => void; disabled?: boolean }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    setCustom("");
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          title={t("wikis.iconPick")}
          aria-label={t("wikis.iconPick")}
          className="h-9 w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-lg hover:border-indigo-300 disabled:opacity-60"
          data-testid="wiki-icon-picker"
        >
          {value ? <span className="leading-none">{value}</span> : <BookOpen size={16} className="text-neutral-400" />}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-2" align="end">
        <button type="button" onClick={() => pick("")} className={cn("w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800", !value && "bg-indigo-50 dark:bg-indigo-950/60")} data-testid="wiki-icon-none">
          <Ban size={14} className="text-neutral-400" /> {t("wikis.iconNone")}
          {!value && <Check size={13} className="ml-auto text-indigo-600" />}
        </button>
        <div className="grid grid-cols-8 gap-1 mt-2">
          {EMOJI.map((e) => (
            <button key={e} type="button" onClick={() => pick(e)} aria-label={e} className={cn("h-8 w-8 rounded-md flex items-center justify-center text-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/60", value === e && "bg-indigo-100 dark:bg-indigo-900/60 ring-1 ring-indigo-400")} data-testid="wiki-icon-option">
              {e}
            </button>
          ))}
        </div>
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            const g = firstGrapheme(custom);
            if (g) pick(g);
          }}
        >
          <Input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={t("wikis.iconCustom")} className="h-8 text-sm" data-testid="wiki-icon-custom" />
          <button type="submit" disabled={!custom.trim()} className="h-8 px-2.5 rounded-md bg-indigo-600 text-white text-sm disabled:opacity-40" aria-label="OK">
            <Check size={14} />
          </button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
