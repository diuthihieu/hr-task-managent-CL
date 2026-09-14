"use client";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/misc";
import { SettingsSection } from "./settings-shell";

const DEFAULTS = {
  taskAssigned: true,
  dueSoon: true,
  mentioned: true,
  statusChanged: false,
  weeklyDigest: true,
};

type Prefs = typeof DEFAULTS;
const STORAGE_KEY = "notification-prefs";

const ROWS: { key: keyof Prefs; label: string; description: string }[] = [
  { key: "taskAssigned", label: "Task assigned to me", description: "When a task is created or reassigned to you." },
  { key: "dueSoon", label: "Due date approaching", description: "A reminder before one of your tasks is due." },
  { key: "mentioned", label: "Mentioned in a comment", description: "When someone tags you on a record." },
  { key: "statusChanged", label: "Status changed on my tasks", description: "When a task you own moves to a new status." },
  { key: "weeklyDigest", label: "Weekly summary", description: "A digest of what's due and what shipped this week." },
];

export function SettingsNotifications() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage, unreadable during SSR render
      if (stored) setPrefs({ ...DEFAULTS, ...JSON.parse(stored) });
    } catch {
      // ignore
    }
  }, []);

  function update(key: keyof Prefs, value: boolean) {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  return (
    <SettingsSection title="Notification Preferences" description="Choose what you want to be notified about. These preferences are saved to this browser.">
      <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-100 dark:divide-neutral-900 max-w-lg">
        {ROWS.map((row) => (
          <div key={row.key} className="flex items-center gap-3 px-3 py-2.5">
            <div className="flex-1 min-w-0">
              <div className="text-sm text-neutral-800 dark:text-neutral-100">{row.label}</div>
              <div className="text-xs text-neutral-400">{row.description}</div>
            </div>
            <Switch checked={prefs[row.key]} onCheckedChange={(v) => update(row.key, v)} />
          </div>
        ))}
      </div>
      <p className="text-xs text-neutral-400 mt-3 max-w-lg">
        Delivery channels (email/Slack) aren&apos;t wired up yet - these toggles govern in-app behavior for now and are
        ready to plug into a delivery channel without another settings redesign.
      </p>
    </SettingsSection>
  );
}
