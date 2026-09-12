"use client";
import { create } from "zustand";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToastItem {
  id: number;
  message: string;
  variant: "success" | "error" | "info";
}

let counter = 0;
const useToastStore = create<{ toasts: ToastItem[]; push: (t: Omit<ToastItem, "id">) => void; remove: (id: number) => void }>(
  (set) => ({
    toasts: [],
    push: (t) => {
      const id = ++counter;
      set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 3500);
    },
    remove: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
  })
);

export const toast = {
  success: (message: string) => useToastStore.getState().push({ message, variant: "success" }),
  error: (message: string) => useToastStore.getState().push({ message, variant: "error" }),
  info: (message: string) => useToastStore.getState().push({ message, variant: "info" }),
};

const icons = { success: CheckCircle2, error: XCircle, info: Info };
const colors = {
  success: "border-green-200 dark:border-green-900 text-green-700 dark:text-green-400",
  error: "border-red-200 dark:border-red-900 text-red-700 dark:text-red-400",
  info: "border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300",
};

export function Toaster() {
  const { toasts, remove } = useToastStore();
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80">
      {toasts.map((t) => {
        const Icon = icons[t.variant];
        return (
          <div
            key={t.id}
            className={cn(
              "flex items-start gap-2 rounded-md border bg-white dark:bg-neutral-900 px-3 py-2.5 text-sm shadow-lg animate-in",
              colors[t.variant]
            )}
          >
            <Icon size={16} className="mt-0.5 shrink-0" />
            <span className="flex-1 text-neutral-800 dark:text-neutral-100">{t.message}</span>
            <button onClick={() => remove(t.id)} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
