"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Apple, CheckCircle2, Copy, Download, EllipsisVertical, PlusSquare, RefreshCw, Share, Smartphone } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";
import { runningAsApp, usePwa } from "./pwa-client";
import { detectPlatform, isIosOtherBrowser, type MobilePlatform } from "@/lib/mobile-platform";

const DISMISS_KEY = "woli.mobileApp.dismissedAt";
const DISMISS_DAYS = 14;

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return Date.now() - at < DISMISS_DAYS * 86_400_000;
  } catch {
    return false;
  }
}


/**
 * "Get woli on your phone": install it as an app (home-screen icon, full screen) on iPhone / iPad or
 * Android. Android with Chrome installs in one tap; iOS shows the Share > Add to Home Screen steps; on a
 * computer a QR code opens woli on the phone. The installed app loads the live site, so it is always on
 * the latest version.
 * `auto`: opens by itself on a phone browser (not when already installed, not again for 14 days once closed).
 */
export function MobileAppPrompt({ auto = false, open: openProp, onOpenChange }: { auto?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  const { t } = useT();
  const installEvent = usePwa((s) => s.installEvent);
  const installed = usePwa((s) => s.installed);
  const [autoOpen, setAutoOpen] = useState(false);
  const [platform, setPlatform] = useState<MobilePlatform>("other");
  const [tab, setTab] = useState<"ios" | "android">("android");
  const [ua, setUa] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  /** The packaged Android app (APK) when one is published. */
  const [apk, setApk] = useState<{ version: string; installerSizeBytes: number | null } | null>(null);
  const open = openProp ?? autoOpen;
  const setOpen = (v: boolean) => {
    if (!v && auto) {
      try {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      } catch {}
    }
    setAutoOpen(v);
    onOpenChange?.(v);
  };

  useEffect(() => {
    const p = detectPlatform(navigator.userAgent, navigator.maxTouchPoints);
    /* eslint-disable react-hooks/set-state-in-effect -- browser-only values, unknown during SSR */
    setPlatform(p);
    setUa(navigator.userAgent);
    setTab(p === "ios" ? "ios" : "android");
    if (auto && p !== "other" && !runningAsApp() && !dismissedRecently()) setAutoOpen(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [auto]);

  const link = typeof window === "undefined" ? "" : `${window.location.origin}/workspaces?source=app`;
  useEffect(() => {
    if (!open || platform !== "other" || !link) return;
    QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: "#171717", light: "#ffffff" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [open, platform, link]);

  useEffect(() => {
    if (!open) return;
    fetch("/api/desktop/releases/latest?platform=android")
      .then((r) => (r.ok ? r.json() : null))
      .then((r) => setApk(r && r.version ? { version: r.version, installerSizeBytes: r.installerSizeBytes } : null))
      .catch(() => setApk(null));
  }, [open]);

  async function install() {
    if (!installEvent) return;
    // Chrome's install event works once: drop it whatever the user picks, so a dismissed dialog falls
    // back to the manual steps until Chrome offers a fresh one.
    usePwa.getState().set({ installEvent: null });
    const choice = await installEvent
      .prompt()
      .then(() => installEvent.userChoice)
      .catch(() => ({ outcome: "dismissed" as const }));
    if (choice.outcome === "accepted") setDone(true);
  }

  function copyLink() {
    navigator.clipboard
      ?.writeText(link)
      .then(() => toast.success(t("mapp.copied")))
      .catch(() => {});
  }

  const step = (n: number, icon: React.ReactNode, text: React.ReactNode) => (
    <li className="flex items-start gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">{n}</span>
      <span className="flex-1 pt-0.5 text-sm text-neutral-700 dark:text-neutral-200">
        {text} {icon ? <span className="ml-1 inline-flex translate-y-0.5 text-indigo-600 dark:text-indigo-300">{icon}</span> : null}
      </span>
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto thin-scroll" data-testid="mobile-app-dialog">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- small static icon */}
          <img src="/pwa/icon-192.png" alt="" className="h-12 w-12 rounded-xl border border-neutral-200 dark:border-neutral-700" />
          <div>
            <DialogTitle className="mb-0.5 text-base">{t("mapp.title")}</DialogTitle>
            <p className="text-xs text-neutral-500">{t("mapp.lead")}</p>
          </div>
        </div>

        {installed || runningAsApp() ? (
          <p className="mt-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" data-testid="mapp-installed">
            <CheckCircle2 size={16} /> {t("mapp.installed")}
          </p>
        ) : (
          <>
            {platform === "other" ? (
              <div className="mt-4 flex items-center gap-4 rounded-lg border border-neutral-200 p-3 dark:border-neutral-800" data-testid="mapp-qr">
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element -- generated data URL
                  <img src={qr} alt={t("mapp.qrAlt")} className="h-32 w-32 shrink-0 rounded" />
                ) : (
                  <div className="h-32 w-32 shrink-0 rounded bg-neutral-100 dark:bg-neutral-800" />
                )}
                <div className="text-sm text-neutral-600 dark:text-neutral-300">
                  <p className="font-medium text-neutral-800 dark:text-neutral-100">{t("mapp.scan")}</p>
                  <p className="mt-1 text-xs">{t("mapp.scanHint")}</p>
                  <button type="button" onClick={copyLink} className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline dark:text-indigo-300">
                    <Copy size={12} /> {t("mapp.copyLink")}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg bg-neutral-100 p-1 text-sm dark:bg-neutral-800" role="tablist">
              {(
                [
                  ["ios", t("mapp.ios"), <Apple key="i" size={14} />],
                  ["android", t("mapp.android"), <Smartphone key="a" size={14} />],
                ] as const
              ).map(([key, label, icon]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => setTab(key)}
                  className={cn("inline-flex items-center justify-center gap-1.5 rounded-md py-1.5", tab === key ? "bg-white font-medium text-neutral-900 shadow-sm dark:bg-neutral-900 dark:text-neutral-100" : "text-neutral-500")}
                  data-testid={`mapp-tab-${key}`}
                >
                  {icon} {label}
                </button>
              ))}
            </div>

            {tab === "ios" ? (
              <div className="mt-4" data-testid="mapp-ios">
                {platform === "ios" && isIosOtherBrowser(ua) ? <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{t("mapp.iosOtherBrowser")}</p> : null}
                <ol className="space-y-3">
                  {step(1, null, t("mapp.ios1"))}
                  {step(2, <Share size={15} />, t("mapp.ios2"))}
                  {step(3, <PlusSquare size={15} />, t("mapp.ios3"))}
                  {step(4, null, t("mapp.ios4"))}
                </ol>
              </div>
            ) : (
              <div className="mt-4" data-testid="mapp-android">
                {apk ? (
                  <div className="mb-4 rounded-lg border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900 dark:bg-indigo-950/30" data-testid="mapp-apk">
                    <a
                      href="/api/desktop/download/latest?platform=android"
                      className="flex w-full items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
                      data-testid="mapp-apk-download"
                    >
                      <Download size={16} /> {t("mapp.apkDownload", { version: apk.version, size: apk.installerSizeBytes ? `${(apk.installerSizeBytes / 1048576).toFixed(1)} MB` : "" })}
                    </a>
                    <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-300">{t("mapp.apkHint")}</p>
                  </div>
                ) : null}
                {apk ? <p className="mb-2 text-xs font-medium text-neutral-500">{t("mapp.orChrome")}</p> : null}
                {done ? (
                  <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                    <CheckCircle2 size={16} /> {t("mapp.androidDone")}
                  </p>
                ) : installEvent ? (
                  <Button className="w-full justify-center py-2.5" onClick={() => void install()} data-testid="mapp-install">
                    <Download size={15} /> {t("mapp.installNow")}
                  </Button>
                ) : (
                  <ol className="space-y-3">
                    {step(1, null, t("mapp.android1"))}
                    {step(2, <EllipsisVertical size={15} />, t("mapp.android2"))}
                    {step(3, <Download size={15} />, t("mapp.android3"))}
                    {step(4, null, t("mapp.android4"))}
                  </ol>
                )}
              </div>
            )}
          </>
        )}

        <p className="mt-5 flex items-start gap-2 border-t border-neutral-100 pt-3 text-xs text-neutral-500 dark:border-neutral-800">
          <RefreshCw size={13} className="mt-0.5 shrink-0" /> {t("mapp.autoUpdate")}
        </p>
      </DialogContent>
    </Dialog>
  );
}

/** A button that opens the "Get woli on your phone" dialog (hidden inside the installed app). */
export function MobileAppButton({ className, children, testId = "mobile-app-open" }: { className?: string; children: React.ReactNode; testId?: string }) {
  const [open, setOpen] = useState(false);
  const installed = usePwa((s) => s.installed);
  if (installed) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} data-testid={testId}>
        {children}
      </button>
      {open ? <MobileAppPrompt open onOpenChange={setOpen} /> : null}
    </>
  );
}
