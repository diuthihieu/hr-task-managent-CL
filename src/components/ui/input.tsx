"use client";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { CharCount } from "./char-count";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-8 w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { hideCount?: boolean };

/** With `maxLength` and a controlled `value`, shows "Max N characters · used/max" underneath. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, hideCount, ...props }, ref) => {
  const el = (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-md border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2.5 py-1.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500",
        className
      )}
      {...props}
    />
  );
  if (hideCount || !props.maxLength || typeof props.value !== "string") return el;
  return (
    <div className="w-full min-w-0">
      {el}
      <CharCount value={props.value} max={props.maxLength} className="mt-0.5" />
    </div>
  );
});
Textarea.displayName = "Textarea";
