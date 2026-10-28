"use client";
// The grid's right-click menu: copy, paste, fill down, insert / delete rows, sub-tasks, move.
import { useState } from "react";
import { ArrowDownToLine, ArrowRightLeft, ClipboardPaste, CopyPlus, ListTree, Copy, Plus, Rows3, ArrowUp, ArrowDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/components/i18n-provider";
import { MAX_INSERT_ROWS, type GridContextMenu } from "./grid-shared";

export function GridClipboardMenu({
  menu,
  rowsSelected,
  multi,
  canPaste,
  canFillDown,
  close,
  copy,
  copyRows,
  paste,
  pasteAsNew,
  fillDown,
  transfer,
  addSubtask,
  defaultInsertCount,
  insertRows,
  deleteCount,
  deleteRows,
}: {
  menu: GridContextMenu;
  rowsSelected: boolean;
  multi: boolean;
  canPaste: boolean;
  canFillDown: boolean;
  close: () => void;
  copy: () => void;
  copyRows: () => void;
  paste: () => void;
  pasteAsNew: () => void;
  fillDown: () => void;
  transfer?: (mode: "move" | "duplicate") => void;
  addSubtask?: () => void;
  defaultInsertCount: number;
  insertRows?: (position: "above" | "below", count: number) => void;
  deleteCount: number;
  deleteRows: () => void;
}) {
  const { t } = useT();
  const [insertCount, setInsertCount] = useState(String(Math.min(Math.max(defaultInsertCount, 1), MAX_INSERT_ROWS)));
  const count = Math.min(Math.max(Math.floor(Number(insertCount)) || 1, 1), MAX_INSERT_ROWS);
  const left = typeof window === "undefined" ? menu.x : Math.min(menu.x, window.innerWidth - 250);
  const top = typeof window === "undefined" ? menu.y : Math.max(8, Math.min(menu.y, window.innerHeight - 460));
  const action = (handler: () => void) => () => {
    close();
    handler();
  };
  const item = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 disabled:pointer-events-none disabled:opacity-40 dark:text-neutral-200 dark:hover:bg-neutral-800";
  const kbd = "ml-auto text-[10px] text-neutral-400";
  return (
    <div className="fixed inset-0 z-[80]" onMouseDown={close} onContextMenu={(event) => { event.preventDefault(); close(); }}>
      <div role="menu" aria-label={t("grid.clipboardMenu")} className="fixed w-60 max-h-[calc(100vh-16px)] overflow-y-auto thin-scroll rounded-md border border-neutral-200 bg-white p-1 shadow-xl dark:border-neutral-800 dark:bg-neutral-900" style={{ left, top }} onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" role="menuitem" className={item} onClick={action(copy)}>
          <Copy size={14} />
          {rowsSelected ? t("grid.copyRows") : multi ? t("grid.copySelection") : t("grid.copyCell")}
          <span className={kbd}>Ctrl+C</span>
        </button>
        <button type="button" role="menuitem" className={item} disabled={!canPaste} onClick={action(paste)}>
          <ClipboardPaste size={14} />
          {t("grid.paste")}
          <span className={kbd}>Ctrl+V</span>
        </button>
        <button type="button" role="menuitem" className={item} disabled={!canFillDown} onClick={action(fillDown)}>
          <ArrowDownToLine size={14} />
          {t("grid.fillDown")}
          <span className={kbd}>Ctrl+D</span>
        </button>
        <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />
        {!rowsSelected ? (
          <button type="button" role="menuitem" className={item} onClick={action(copyRows)}>
            <Rows3 size={14} />
            {t("grid.copyRows")}
          </button>
        ) : null}
        <button type="button" role="menuitem" className={item} disabled={!canPaste} onClick={action(pasteAsNew)}>
          <Plus size={14} />
          {t("grid.pasteAsNew")}
        </button>
        {insertRows ? (
          <>
            <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />
            <div className="flex items-center gap-1.5 px-2 py-1 text-sm text-neutral-700 dark:text-neutral-200" data-testid="grid-insert-rows">
              <Plus size={14} className="shrink-0" />
              {t("grid.insertRows")}
              <input
                type="number"
                min={1}
                max={MAX_INSERT_ROWS}
                value={insertCount}
                onChange={(event) => setInsertCount(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Enter") action(() => insertRows("below", count))();
                  if (event.key === "Escape") close();
                }}
                className="h-6 w-12 rounded border border-neutral-200 bg-white px-1 text-center text-sm dark:border-neutral-700 dark:bg-neutral-950"
                aria-label={t("grid.insertRowsCount")}
                data-testid="grid-insert-count"
              />
              <span className="text-neutral-500">{t("grid.rowsWord")}</span>
            </div>
            <div className="flex gap-1 px-2 pb-1">
              <button type="button" role="menuitem" className={cn(item, "justify-center border border-neutral-200 dark:border-neutral-700")} title={t("grid.insertAboveTitle", { n: count })} onClick={action(() => insertRows("above", count))} data-testid="grid-insert-above">
                <ArrowUp size={13} />
                {t("grid.insertAbove")}
              </button>
              <button type="button" role="menuitem" className={cn(item, "justify-center border border-neutral-200 dark:border-neutral-700")} title={t("grid.insertBelowTitle", { n: count })} onClick={action(() => insertRows("below", count))} data-testid="grid-insert-below">
                <ArrowDown size={13} />
                {t("grid.insertBelow")}
              </button>
            </div>
          </>
        ) : null}
        {addSubtask ? (
          <>
            <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />
            <button type="button" role="menuitem" className={item} onClick={action(addSubtask)}>
              <ListTree size={14} />
              {t("grid.addSubtask")}
            </button>
          </>
        ) : null}
        {transfer ? (
          <>
            <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />
            <button type="button" role="menuitem" className={item} onClick={action(() => transfer("move"))}>
              <ArrowRightLeft size={14} />
              {t("tt.moveMenu")}
            </button>
            <button type="button" role="menuitem" className={item} onClick={action(() => transfer("duplicate"))}>
              <CopyPlus size={14} />
              {t("tt.duplicateMenu")}
            </button>
          </>
        ) : null}
        {deleteCount > 0 ? (
          <>
            <div className="my-1 h-px bg-neutral-100 dark:bg-neutral-800" />
            <button type="button" role="menuitem" className={cn(item, "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40")} onClick={action(deleteRows)} data-testid="grid-delete-rows">
              <Trash2 size={14} />
              {t("grid.deleteRows", { n: deleteCount })}
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
