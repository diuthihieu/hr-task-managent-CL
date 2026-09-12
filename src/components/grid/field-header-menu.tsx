"use client";
import { MoreHorizontal, Pencil, Copy, EyeOff, ArrowLeftToLine, ArrowRightToLine, PinOff, ArrowUpAZ, ArrowDownAZ, ListFilter, Group, Trash2, MessageSquare, Paintbrush, ChevronRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { FIELD_TYPES, FIELD_CATEGORY_LABELS, type FieldCategory } from "@/lib/field-types";
import type { FieldRow } from "@/types";

const CATEGORIES: FieldCategory[] = ["basic", "selection", "people", "contact", "files", "calculated", "relational", "system", "action"];

export function FieldHeaderMenu({ field, onAction }: { field: FieldRow; onAction: (action: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0">
          <MoreHorizontal size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={() => onAction("edit")}>
          <Pencil size={13} /> Edit field
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-neutral-700 dark:text-neutral-200 outline-none cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 data-[state=open]:bg-neutral-100 dark:data-[state=open]:bg-neutral-800">
            Field type
            <ChevronRight size={13} className="ml-auto" />
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 overflow-y-auto thin-scroll">
            {CATEGORIES.map((cat, i) => {
              const items = FIELD_TYPES.filter((f) => f.category === cat && !f.comingSoon);
              if (!items.length) return null;
              return (
                <div key={cat}>
                  {i > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuLabel>{FIELD_CATEGORY_LABELS[cat]}</DropdownMenuLabel>
                  {items.map((f) => (
                    <DropdownMenuItem key={f.type} onSelect={() => onAction(`type:${f.type}`)} className={f.type === field.type ? "font-semibold text-indigo-600 dark:text-indigo-400" : ""}>
                      {f.label}
                    </DropdownMenuItem>
                  ))}
                </div>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem onSelect={() => onAction("description")}>
          <MessageSquare size={13} /> Edit description
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("conditional_format")}>
          <Paintbrush size={13} /> Conditional formatting
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onAction("duplicate")}>
          <Copy size={13} /> Duplicate field
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("hide")}>
          <EyeOff size={13} /> Hide field
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("insert_left")}>
          <ArrowLeftToLine size={13} /> Insert left
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("insert_right")}>
          <ArrowRightToLine size={13} /> Insert right
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("freeze")}>
          <PinOff size={13} /> Freeze up to this field
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onAction("sort_asc")}>
          <ArrowUpAZ size={13} /> Sort ascending
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("sort_desc")}>
          <ArrowDownAZ size={13} /> Sort descending
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("group")}>
          <Group size={13} /> Group by field
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onAction("filter")}>
          <ListFilter size={13} /> Filter by field
        </DropdownMenuItem>
        {!field.isPrimary && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onAction("delete")} className="text-red-600 dark:text-red-400">
              <Trash2 size={13} /> Delete field
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
