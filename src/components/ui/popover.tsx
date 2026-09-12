"use client";
import * as RPopover from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = RPopover.Root;
export const PopoverTrigger = RPopover.Trigger;
export const PopoverClose = RPopover.Close;

export function PopoverContent({ className, ...props }: React.ComponentProps<typeof RPopover.Content>) {
  return (
    <RPopover.Portal>
      <RPopover.Content
        sideOffset={6}
        align="start"
        className={cn(
          "z-50 rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 shadow-lg focus:outline-none",
          className
        )}
        {...props}
      />
    </RPopover.Portal>
  );
}
