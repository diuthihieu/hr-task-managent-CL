"use client";
import { MoreHorizontal, Pencil, Copy, EyeOff, ArrowLeftToLine, ArrowRightToLine, PinOff, ArrowUpAZ, ArrowDownAZ, ListFilter, Group, Trash2, MessageSquare, Paintbrush } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { FieldRow } from "@/types";
import { useT } from "@/components/i18n-provider";

export function FieldHeaderMenu({ field, onAction }: { field: FieldRow; onAction: (action: string) => void }) {
  const { t } = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0">
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {!field.system && (
          <>
            <DropdownMenuItem onSelect={() => onAction("edit")}>
              <Pencil size={13} /> {t("fhm.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAction("description")}>
              <MessageSquare size={13} /> {t("fhm.description")}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onSelect={() => onAction("conditional_format")}>
          <Paintbrush size={13} /> {t("fhm.format")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onAction("duplicate")}>
          <Copy size={13} /> {t("fhm.duplicate")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("hide")}>
          <EyeOff size={13} /> {t("fhm.hide")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("insert_left")}>
          <ArrowLeftToLine size={13} /> {t("fhm.insertLeft")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("insert_right")}>
          <ArrowRightToLine size={13} /> {t("fhm.insertRight")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("freeze")}>
          <PinOff size={13} /> {t("fhm.freeze")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onAction("sort_asc")}>
          <ArrowUpAZ size={13} /> {t("fhm.sortAsc")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("sort_desc")}>
          <ArrowDownAZ size={13} /> {t("fhm.sortDesc")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("group")}>
          <Group size={13} /> {t("fhm.group")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("filter")}>
          <ListFilter size={13} /> {t("fhm.filter")}
        </DropdownMenuItem>
        {!field.system && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction("delete")} className="text-red-600 dark:text-red-400">
              <Trash2 size={13} /> {t("fhm.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
