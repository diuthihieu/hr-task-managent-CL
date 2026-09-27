"use client";
import { Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { FIELD_TYPES, FIELD_CATEGORY_LABELS, CUSTOM_FIELD_TYPE_IDS, type FieldCategory } from "@/lib/field-types";

const CATEGORIES: FieldCategory[] = ["basic", "selection", "people", "contact", "files", "calculated", "relational", "system", "action"];

export function AddFieldButton({ onSelect }: { onSelect: (type: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center justify-center h-8 w-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800" title="Add custom field">
          <Plus size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-96 overflow-y-auto thin-scroll">
        {CATEGORIES.map((cat, i) => {
          const items = FIELD_TYPES.filter((f) => f.category === cat && CUSTOM_FIELD_TYPE_IDS.includes(f.type));
          if (!items.length) return null;
          return (
            <div key={cat}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{FIELD_CATEGORY_LABELS[cat]}</DropdownMenuLabel>
              {items.map((f) => (
                <DropdownMenuItem key={f.type} onSelect={() => onSelect(f.type)}>
                  <span className="flex-1">{f.label}</span>
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
