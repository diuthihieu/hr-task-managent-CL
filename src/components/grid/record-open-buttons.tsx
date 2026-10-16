"use client";
import { Maximize2, PanelRightOpen } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

/**
 * The two ways to open a task from any view: the side panel (same drawer as
 * All tasks) or the full task page. Shown on hover with a mouse, always on
 * touch screens. Stops pointer events so drag-and-drop cards don't start a drag.
 */
export function RecordOpenButtons({ onOpen, onOpenPage, className, size = 12 }: { onOpen: () => void; onOpenPage?: () => void; className?: string; size?: number }) {
  const { t } = useT();
  const btn = "p-0.5 rounded text-neutral-400 hover:text-indigo-600 hover:bg-neutral-100 dark:hover:bg-neutral-800";
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <span className={cn("inline-flex items-center gap-0.5 shrink-0", className)} onPointerDown={stop} onMouseDown={stop} onClick={stop} onKeyDown={stop}>
      <button type="button" onClick={onOpen} className={btn} title={t("grid.expand")} aria-label={t("grid.expand")} data-testid="record-open-side">
        <PanelRightOpen size={size} />
      </button>
      {onOpenPage && (
        <button type="button" onClick={onOpenPage} className={btn} title={t("record.openAsPage")} aria-label={t("record.openAsPage")} data-testid="record-open-page">
          <Maximize2 size={size} />
        </button>
      )}
    </span>
  );
}

/** Hover-reveal classes for the buttons inside a `group/<name>` container; always visible on touch. */
export const revealOn = {
  card: "opacity-0 group-hover/card:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
  row: "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
  gr: "opacity-0 group-hover/gr:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100",
};
