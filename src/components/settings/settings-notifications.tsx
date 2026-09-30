"use client";
// Personal notification settings: per group, whether it pops up inside the app
// and whether it reaches the desktop / phone as a system notification; plus
// the ringtone. Everything still lands in the Action center.
import { useEffect, useState } from "react";
import { BellRing, Loader2, MonitorSmartphone, Play, Volume2 } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useInbox } from "@/components/notifications/notification-bell";
import { DEFAULT_NOTIFY_SETTINGS, NOTIFY_GROUP_KEYS, RINGTONES, playRingtone, type NotifyGroup, type NotifySettings, type Ringtone } from "@/lib/notification-prefs";
import type { MessageKey } from "@/lib/i18n/core";
import { SettingsSection } from "./settings-shell";

export function SettingsNotifications() {
  const { t } = useT();
  const [s, setS] = useState<NotifySettings | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  useEffect(() => {
    api.get<NotifySettings>("/api/account/notification-settings").then(setS).catch(() => setS(DEFAULT_NOTIFY_SETTINGS));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only value
    if ("Notification" in window) setPermission(Notification.permission);
  }, []);

  async function save(patch: Partial<NotifySettings>) {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    useInbox.getState().set({ settings: next });
    try {
      await api.put("/api/account/notification-settings", patch);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }
  const toggle = (list: "popupOff" | "nativeOff", g: NotifyGroup, on: boolean) => {
    if (!s) return;
    save({ [list]: on ? s[list].filter((x) => x !== g) : [...s[list], g] } as Partial<NotifySettings>);
  };

  if (!s)
    return (
      <div className="p-10 flex justify-center text-neutral-400">
        <Loader2 className="animate-spin" size={18} />
      </div>
    );
  return (
    <SettingsSection title={t("set.notifications")} description={t("notifset.desc")}>
      <div className="max-w-3xl space-y-6" data-testid="notif-settings">
        <section>
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden">
            <div className="grid grid-cols-[1fr_6.5rem_6.5rem] items-center gap-2 px-4 py-2 bg-neutral-50 dark:bg-neutral-900 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              <span>{t("notifset.type")}</span>
              <span className="inline-flex items-center gap-1 justify-center text-center">
                <BellRing size={12} /> {t("notifset.popup")}
              </span>
              <span className="inline-flex items-center gap-1 justify-center text-center">
                <MonitorSmartphone size={12} /> {t("notifset.native")}
              </span>
            </div>
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {NOTIFY_GROUP_KEYS.map((g) => (
                <li key={g} className="grid grid-cols-[1fr_6.5rem_6.5rem] items-center gap-2 px-4 py-2.5" data-testid={`notif-row-${g}`}>
                  <span>
                    <span className="block text-sm font-medium">{t(`ac.group.${g}` as MessageKey)}</span>
                    <span className="block text-[11px] text-neutral-500">{t(`notifset.hint.${g}` as MessageKey)}</span>
                  </span>
                  <span className="flex justify-center" data-testid={`notif-popup-${g}`}>
                    <Switch checked={!s.popupOff.includes(g)} onCheckedChange={(v) => toggle("popupOff", g, v)} />
                  </span>
                  <span className="flex justify-center" data-testid={`notif-native-${g}`}>
                    <Switch checked={!s.nativeOff.includes(g)} onCheckedChange={(v) => toggle("nativeOff", g, v)} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-2 text-[11px] text-neutral-500">{t("notifset.always")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-neutral-50 dark:bg-neutral-900 px-3 py-2 text-xs">
            <MonitorSmartphone size={14} className="text-indigo-600" />
            <span className="flex-1 min-w-[12rem] text-neutral-600 dark:text-neutral-300">
              {permission === "granted" ? t("notifset.perm.granted") : permission === "denied" ? t("notifset.perm.denied") : permission === "unsupported" ? t("notifset.perm.unsupported") : t("notifset.perm.default")}
            </span>
            {permission === "default" && (
              <Button size="sm" onClick={async () => setPermission(await Notification.requestPermission())} data-testid="notif-allow">
                {t("notifset.perm.allow")}
              </Button>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-sm font-semibold mb-2 inline-flex items-center gap-1.5">
            <Volume2 size={14} className="text-indigo-600" /> {t("notifset.sound")}
          </h3>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
            {RINGTONES.map((r) => (
              <button
                key={r}
                onClick={() => {
                  save({ sound: r as Ringtone });
                  playRingtone(r as Ringtone, s.volume);
                }}
                className={cn("flex items-center gap-2 rounded-lg border px-3 py-2 text-sm text-left", s.sound === r ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 font-medium" : "border-neutral-200 dark:border-neutral-800 hover:border-neutral-300")}
                data-testid={`ringtone-${r}`}
                aria-pressed={s.sound === r}
              >
                {r !== "none" && <Play size={12} className="shrink-0 opacity-70" />}
                <span className="truncate">{t(`notifset.ring.${r}` as MessageKey)}</span>
              </button>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-3 text-xs text-neutral-600 dark:text-neutral-300">
            <span className="w-16">{t("notifset.volume")}</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={s.volume}
              disabled={s.sound === "none"}
              onChange={(e) => setS({ ...s, volume: Number(e.target.value) })}
              onPointerUp={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                save({ volume: v });
                playRingtone(s.sound, v);
              }}
              onKeyUp={(e) => save({ volume: Number((e.target as HTMLInputElement).value) })}
              className="flex-1 accent-indigo-600"
              data-testid="notif-volume"
            />
            <span className="w-8 tabular-nums text-right">{s.volume}</span>
          </label>
        </section>
      </div>
    </SettingsSection>
  );
}
