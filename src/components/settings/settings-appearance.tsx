"use client";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-shell";

export function SettingsAppearance() {
  const { theme, toggle } = useTheme();

  return (
    <SettingsSection title="Appearance / Theme" description="Choose how the workspace looks on this device.">
      <div className="flex gap-3 max-w-md">
        {(["light", "dark"] as const).map((t) => (
          <button
            key={t}
            onClick={() => t !== theme && toggle()}
            className={cn(
              "flex-1 flex flex-col items-center gap-2 rounded-lg border-2 px-4 py-4 transition-colors",
              theme === t ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950" : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700"
            )}
          >
            {t === "light" ? <Sun size={20} className="text-amber-500" /> : <Moon size={20} className="text-indigo-400" />}
            <span className="text-sm font-medium capitalize text-neutral-800 dark:text-neutral-100">{t}</span>
          </button>
        ))}
      </div>
    </SettingsSection>
  );
}
