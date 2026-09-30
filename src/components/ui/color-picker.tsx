"use client";
import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { useT } from "@/components/i18n-provider";

export const COLOR_PALETTE = ["#94a3b8", "#64748b", "#3b82f6", "#0ea5e9", "#14b8a6", "#22c55e", "#84cc16", "#eab308", "#f97316", "#ef4444", "#ec4899", "#8b5cf6", "#6366f1", "#a16207"];
const COLORS = COLOR_PALETTE;

/** One color swatch; click to choose from the palette or any custom color. */
export function ColorPicker({ color, disabled, onPick, label, testId }: { color: string; disabled?: boolean; onPick: (c: string) => void; label: string; testId?: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(color);
  return (
    <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
      <PopoverTrigger asChild>
        <button disabled={disabled} className="h-8 w-8 rounded-lg border border-neutral-200 dark:border-neutral-700 flex items-center justify-center disabled:cursor-not-allowed" title={label} aria-label={label} data-testid={testId ?? "color-swatch"}>
          <span className="h-4 w-4 rounded-full" style={{ backgroundColor: color }} />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56">
        <div className="grid grid-cols-7 gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
              className="h-6 w-6 rounded-full flex items-center justify-center ring-offset-1 hover:ring-2 hover:ring-neutral-300"
              style={{ backgroundColor: c }}
              aria-label={c}
              data-testid="color-option"
            >
              {c.toLowerCase() === color.toLowerCase() && <Check size={12} className="text-white" />}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input type="color" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-7 w-9 rounded border border-neutral-200 dark:border-neutral-700 bg-transparent" aria-label={t("st.customColor")} />
          <span className="text-xs font-mono text-neutral-500 flex-1">{custom}</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onPick(custom);
              setOpen(false);
            }}
          >
            {t("st.useColor")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
