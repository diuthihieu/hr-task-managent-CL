"use client";
import { useEffect, useState } from "react";
import { create } from "zustand";
import { RefreshCw } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { newerVersion } from "@/lib/mobile-platform";

/** Chrome's install event (Android / desktop Chrome, Edge): lets our button open the system install dialog. */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

interface PwaState {
  installEvent: InstallPromptEvent | null;
  installed: boolean;
  set: (p: Partial<PwaState>) => void;
}
export const usePwa = create<PwaState>((set) => ({ installEvent: null, installed: false, set: (p) => set(p) }));

/**
 * Set by the Android app's start address (/android-app?v=1.0.0) to that app's version. Session storage
 * belongs to the app window only: ordinary Chrome tabs on the same site share local storage and cookies
 * with the app, but must not be treated as the app.
 */
const ANDROID_APP_KEY = "woli.androidApp";

export function rememberAndroidApp(version: string | null) {
  try {
    sessionStorage.setItem(ANDROID_APP_KEY, version && /^\d+\.\d+\.\d+/.test(version) ? version : "0.0.0");
  } catch {}
}

/** Version of the Android app this window runs in, or null in a browser tab / home-screen app. */
export function androidAppVersion(): string | null {
  try {
    return sessionStorage.getItem(ANDROID_APP_KEY);
  } catch {
    return null;
  }
}

/** Running as an installed app (home-screen icon or the Android app), not in a browser tab. */
export function runningAsApp(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return androidAppVersion() !== null;
}

const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "";

const CHECK_EVERY_MS = 15 * 60_000;
/** Reload into a new build on returning only after this long away (so nothing half-typed is lost). */
const AWAY_MS_APP = 2 * 60_000;
const AWAY_MS_TAB = 30 * 60_000;

/**
 * Mounted once in the root layout:
 * - registers the service worker (installable app, offline page);
 * - keeps Chrome's install event for the "Install" button;
 * - keeps the app up to date: when the server runs a newer build than the one loaded, the app reloads
 *   into it the next time it comes back to the foreground (or right away with "Update now").
 */
export function PwaClient() {
  const { t } = useT();
  const [updateReady, setUpdateReady] = useState(false);
  /** A newer Android app (APK) than the installed one, when running inside it. */
  const [apkUpdate, setApkUpdate] = useState<string | null>(null);

  // Inside the Android app the web part updates by itself; the app shell rarely changes, but when a
  // newer APK is published the user is offered it once per session.
  useEffect(() => {
    const installedApk = androidAppVersion();
    if (!installedApk) return;
    usePwa.getState().set({ installed: true });
    fetch("/api/desktop/releases/latest?platform=android")
      .then((r) => (r.ok ? r.json() : null))
      .then((latest: { version?: string } | null) => {
        if (latest?.version && newerVersion(latest.version, installedApk)) setApkUpdate(latest.version);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const set = usePwa.getState().set;
    set({ installed: runningAsApp() || usePwa.getState().installed });
    const onPrompt = (e: Event) => {
      e.preventDefault(); // shown from our own button instead of the mini-infobar
      set({ installEvent: e as InstallPromptEvent });
    };
    const onInstalled = () => set({ installed: true, installEvent: null });
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    let registration: ServiceWorkerRegistration | undefined;
    if ("serviceWorker" in navigator && window.isSecureContext && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((r) => (registration = r))
        .catch(() => {});
    }

    let found = false;
    let hiddenAt = 0;
    /** Resolves true when the server runs a newer build than the one loaded. */
    const check = async (): Promise<boolean> => {
      if (!BUILD_ID || found) return found;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        const { buildId } = (await res.json()) as { buildId?: string };
        if (buildId && buildId !== BUILD_ID) {
          found = true;
          setUpdateReady(true);
          registration?.update().catch(() => {});
        }
      } catch {
        // offline: try again later
      }
      return found;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      // Back in the foreground after a while with a newer build waiting: load it. A short switch away
      // (e.g. copying something) keeps the page; the "Update now" banner stays until the next time.
      // Timers may not run while a phone app is suspended, so ask the server now, then decide.
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      void check().then((newer) => {
        if (newer && away >= (runningAsApp() ? AWAY_MS_APP : AWAY_MS_TAB)) window.location.reload();
      });
    };
    void check();
    const timer = window.setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, []);

  if (!updateReady) {
    if (!apkUpdate) return null;
    return (
      <div className="fixed inset-x-0 bottom-[calc(0.75rem+var(--app-bottom))] z-[95] flex justify-center px-3 pointer-events-none" role="status" data-testid="apk-update">
        <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <span className="text-neutral-700 dark:text-neutral-200">{t("mapp.apkUpdate", { version: apkUpdate })}</span>
          <a href="/api/desktop/download/latest?platform=android" className="font-medium text-indigo-600 hover:underline dark:text-indigo-300">
            {t("mapp.apkUpdateGet")}
          </a>
          <button type="button" onClick={() => setApkUpdate(null)} className="text-neutral-400" aria-label={t("common.close")}>
            ×
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-x-0 bottom-[calc(0.75rem+var(--app-bottom))] z-[95] flex justify-center px-3 pointer-events-none" role="status" data-testid="pwa-update">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-neutral-200 bg-white px-4 py-2 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
        <span className="text-neutral-700 dark:text-neutral-200">{t("pwa.updateReady")}</span>
        <button type="button" onClick={() => window.location.reload()} className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-300" data-testid="pwa-update-now">
          <RefreshCw size={13} /> {t("pwa.updateNow")}
        </button>
      </div>
    </div>
  );
}
