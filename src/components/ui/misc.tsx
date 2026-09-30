"use client";
import { cn } from "@/lib/utils";
import * as RCheckbox from "@radix-ui/react-checkbox";
import * as RSwitch from "@radix-ui/react-switch";
import * as RTabs from "@radix-ui/react-tabs";
import * as RTooltip from "@radix-ui/react-tooltip";
import * as RSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

export function Badge({ className, style, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", className)}
      style={style}
      {...props}
    />
  );
}

export function Checkbox({ checked, onCheckedChange, className }: { checked: boolean; onCheckedChange: (v: boolean) => void; className?: string }) {
  return (
    <RCheckbox.Root
      checked={checked}
      onCheckedChange={(v) => onCheckedChange(!!v)}
      className={cn(
        "h-4 w-4 shrink-0 rounded border border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900 data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600 flex items-center justify-center",
        className
      )}
    >
      <RCheckbox.Indicator className="text-white">
        <Check size={11} strokeWidth={3} />
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
}

export function Switch({ checked, onCheckedChange }: { checked: boolean; onCheckedChange: (v: boolean) => void }) {
  return (
    <RSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      className="w-8 h-[18px] rounded-full bg-neutral-300 dark:bg-neutral-700 data-[state=checked]:bg-indigo-600 relative transition-colors"
    >
      <RSwitch.Thumb className="block h-3.5 w-3.5 rounded-full bg-white translate-x-0.5 data-[state=checked]:translate-x-[15px] transition-transform" />
    </RSwitch.Root>
  );
}

export const Tabs = RTabs.Root;
export const TabsList = ({ className, ...props }: React.ComponentProps<typeof RTabs.List>) => (
  <RTabs.List className={cn("flex items-center gap-0.5", className)} {...props} />
);
export const TabsTrigger = ({ className, ...props }: React.ComponentProps<typeof RTabs.Trigger>) => (
  <RTabs.Trigger
    className={cn(
      "px-3 py-1.5 text-sm rounded-md text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-100 data-[state=active]:bg-neutral-100 dark:data-[state=active]:bg-neutral-800 data-[state=active]:text-neutral-900 dark:data-[state=active]:text-neutral-50 font-medium",
      className
    )}
    {...props}
  />
);
export const TabsContent = RTabs.Content;

export function Tooltip({ children, content }: { children: React.ReactNode; content: string }) {
  return (
    <RTooltip.Provider delayDuration={300}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            sideOffset={4}
            className="z-50 rounded-md bg-neutral-900 text-white text-xs px-2 py-1 shadow-lg"
          >
            {content}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
  "data-testid": testId,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "data-testid"?: string;
}) {
  // Radix treats "" as "no value" (shows the placeholder), but our option
  // lists use "" for "All ..." / "None" - map it to a sentinel internally.
  const EMPTY = "__empty__";
  return (
    <RSelect.Root value={value === "" ? EMPTY : value} onValueChange={(v) => onValueChange(v === EMPTY ? "" : v)} disabled={disabled}>
      <RSelect.Trigger
        data-testid={testId}
        className={cn(
          "disabled:cursor-not-allowed disabled:opacity-60 flex h-8 items-center justify-between gap-1 rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 text-sm whitespace-nowrap overflow-hidden [&>span]:truncate",
          className
        )}
      >
        <RSelect.Value placeholder={placeholder} />
        <RSelect.Icon>
          <ChevronDown size={14} />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content className="z-50 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-lg">
          <RSelect.Viewport className="p-1">
            {options.map((o) => (
              <RSelect.Item
                key={o.value || EMPTY}
                value={o.value || EMPTY}
                className="flex items-center rounded-sm px-2 py-1.5 text-sm text-neutral-700 dark:text-neutral-200 outline-none cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 data-[state=checked]:font-medium"
              >
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}
