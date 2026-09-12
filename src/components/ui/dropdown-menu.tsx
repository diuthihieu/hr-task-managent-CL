"use client";
import * as RDropdown from "@radix-ui/react-dropdown-menu";
import { cn } from "@/lib/utils";

export const DropdownMenu = RDropdown.Root;
export const DropdownMenuTrigger = RDropdown.Trigger;
export const DropdownMenuSub = RDropdown.Sub;
export const DropdownMenuSubTrigger = RDropdown.SubTrigger;
export const DropdownMenuPortal = RDropdown.Portal;

export function DropdownMenuContent({ className, ...props }: React.ComponentProps<typeof RDropdown.Content>) {
  return (
    <RDropdown.Portal>
      <RDropdown.Content
        sideOffset={4}
        align="start"
        className={cn(
          "z-50 min-w-[180px] rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-1 shadow-lg",
          className
        )}
        {...props}
      />
    </RDropdown.Portal>
  );
}

export function DropdownMenuSubContent({ className, ...props }: React.ComponentProps<typeof RDropdown.SubContent>) {
  return (
    <RDropdown.SubContent
      className={cn(
        "z-50 min-w-[160px] rounded-md border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-1 shadow-lg",
        className
      )}
      {...props}
    />
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof RDropdown.Item>) {
  return (
    <RDropdown.Item
      className={cn(
        "flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-neutral-700 dark:text-neutral-200 outline-none cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800 data-[disabled]:opacity-40 data-[disabled]:pointer-events-none",
        className
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof RDropdown.Separator>) {
  return <RDropdown.Separator className={cn("my-1 h-px bg-neutral-200 dark:bg-neutral-800", className)} {...props} />;
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof RDropdown.Label>) {
  return <RDropdown.Label className={cn("px-2 py-1 text-xs font-medium text-neutral-400", className)} {...props} />;
}
