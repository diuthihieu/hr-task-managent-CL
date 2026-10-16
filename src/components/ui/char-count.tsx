"use client";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

/** Small line under a limited text box: "Max N characters" and a live "used/max" count. */
export function CharCount({ value, max, className }: { value: string | undefined | null; max: number; className?: string }) {
  const { t, locale } = useT();
  const used = (value ?? "").length;
  const fmt = (n: number) => n.toLocaleString(locale === "vi" ? "vi-VN" : "en-US");
  return (
    <div className={cn("mt-1 flex items-center justify-between gap-2 text-[11px] text-neutral-400", className)} data-testid="char-count">
      <span>{t("common.maxChars", { n: fmt(max) })}</span>
      <span className={cn("tabular-nums", used >= max ? "text-red-500 font-medium" : used >= max * 0.9 && "text-amber-600")} aria-live="polite">
        {fmt(used)}/{fmt(max)}
      </span>
    </div>
  );
}
