"use client";
import { Plus } from "lucide-react";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { FIELD_TYPES, CREATABLE_CUSTOM_FIELD_TYPE_IDS, type FieldCategory } from "@/lib/field-types";
import type { MessageKey } from "@/lib/i18n/core";
import { useT } from "@/components/i18n-provider";

const CATEGORIES: FieldCategory[] = ["basic", "selection", "people", "contact", "files", "calculated", "relational", "system", "action"];

export function AddFieldButton({ onSelect }: { onSelect: (type: string) => void }) {
  const { t } = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center justify-center h-8 w-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t("fe.addCustom")}>
          <Plus size={15} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-96 overflow-y-auto thin-scroll">
        {CATEGORIES.map((cat, i) => {
          const items = FIELD_TYPES.filter((f) => f.category === cat && CREATABLE_CUSTOM_FIELD_TYPE_IDS.includes(f.type));
          if (!items.length) return null;
          return (
            <div key={cat}>
              {i > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{t(`fc.${cat}` as MessageKey)}</DropdownMenuLabel>
              {items.map((f) => (
                <DropdownMenuItem key={f.type} onSelect={() => onSelect(f.type)}>
                  <span className="flex-1">{t(`ft.${f.type}` as MessageKey)}</span>
                </DropdownMenuItem>
              ))}
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
