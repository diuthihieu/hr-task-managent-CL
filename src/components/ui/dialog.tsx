"use client";
import * as RDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = RDialog.Root;
export const DialogTrigger = RDialog.Trigger;

// Radix Select/Popover/DropdownMenu content is rendered into its own portal
// tagged with this attribute. When one of those is nested inside a Dialog
// (e.g. a "Type" <Select> in a form dialog), a real pointer click on its
// portaled option list looks like a click *outside* the Dialog's own
// content to Radix's dismissable-layer detection, closing the Dialog out
// from under the user. Ignoring outside-interactions that originate inside
// such a portal fixes that without affecting genuine outside clicks.
function isInsideRadixPopper(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest("[data-radix-popper-content-wrapper]");
}

export function DialogContent({
  className,
  children,
  onPointerDownOutside,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof RDialog.Content>) {
  return (
    <RDialog.Portal>
      <RDialog.Overlay className="fixed inset-0 bg-black/40 z-40 animate-in fade-in" />
      <RDialog.Content
        className={cn(
          "fixed left-1/2 top-1/2 z-50 w-[calc(100%-1.5rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto thin-scroll -translate-x-1/2 -translate-y-1/2 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 shadow-xl focus:outline-none",
          className
        )}
        onPointerDownOutside={(e) => {
          if (isInsideRadixPopper(e.target)) e.preventDefault();
          onPointerDownOutside?.(e);
        }}
        onInteractOutside={(e) => {
          if (isInsideRadixPopper(e.target)) e.preventDefault();
          onInteractOutside?.(e);
        }}
        {...props}
      >
        {children}
        <RDialog.Close className="absolute right-3 top-3 rounded-sm text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
          <X size={16} />
        </RDialog.Close>
      </RDialog.Content>
    </RDialog.Portal>
  );
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof RDialog.Title>) {
  return <RDialog.Title className={cn("text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-3", className)} {...props} />;
}

export const DialogClose = RDialog.Close;
