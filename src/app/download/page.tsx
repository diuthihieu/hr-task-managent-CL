import Link from "next/link";
import { headers } from "next/headers";
import { Monitor, Download, ShieldCheck, ArrowLeft, Info } from "lucide-react";
import { getServerT } from "@/lib/prefs";
import { getPublishedReleases, pickLatest, compareSemver, desktopVersionFromUserAgent, DEFAULT_PLATFORM } from "@/lib/desktop-releases";

export const dynamic = "force-dynamic";
export const metadata = { title: "Download woli for Windows" };

function formatSize(bytes: bigint | null) {
  if (bytes === null) return null;
  return `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`;
}


// Public page: the installer only opens the sign-in screen, so it isn't secret.
// All release data comes from the desktop_releases table (see /api/desktop/*).
export default async function DownloadPage({ searchParams }: { searchParams: Promise<{ unavailable?: string }> }) {
  const [{ unavailable }, h] = await Promise.all([searchParams, headers()]);
  const releases = await getPublishedReleases(DEFAULT_PLATFORM, "stable");
  const latest = pickLatest(releases);
  const previous = releases.filter((r) => r.id !== latest?.id).sort((a, b) => compareSemver(b.version, a.version)).slice(0, 5);
  const runningVersion = desktopVersionFromUserAgent(h.get("user-agent"));
  const outdated = runningVersion && latest && compareSemver(latest.version, runningVersion) > 0;
  const { t, locale } = await getServerT();
  const formatDate = (d: Date) => d.toLocaleDateString(locale === "vi" ? "vi-VN" : "en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 mb-6">
          <ArrowLeft size={14} /> {t("dl.back")}
        </Link>

        <div className="flex items-start gap-4 mb-8">
          <div className="h-12 w-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <Monitor size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">{t("landing.desktop.title")}</h1>
            <p className="text-sm text-neutral-500 mt-1">
              {t("dl.subtitle")}
            </p>
          </div>
        </div>

        {runningVersion && (
          <div className="mb-6 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 px-4 py-3 text-sm flex items-start gap-2">
            <Info size={16} className="text-indigo-600 shrink-0 mt-0.5" />
            <span>
              {t("dl.using", { version: runningVersion })} {outdated ? t("dl.outdated", { version: latest!.version }) : t("dl.upToDate")}
            </span>
          </div>
        )}

        {latest ? (
          <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6" aria-labelledby="latest-heading">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 justify-between">
              <div>
                <h2 id="latest-heading" className="text-lg font-semibold">
                  {t("landing.desktop.version", { version: "" })}<span data-testid="desktop-version">{latest.version}</span>
                </h2>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-neutral-500">{t("dl.released")}</dt>
                  <dd data-testid="desktop-release-date">{formatDate(latest.publishedAt)}</dd>
                  <dt className="text-neutral-500">{t("dl.os")}</dt>
                  <dd data-testid="desktop-os">{latest.minOsVersion}</dd>
                  <dt className="text-neutral-500">{t("dl.file")}</dt>
                  <dd>
                    {latest.installerFileName}
                    {formatSize(latest.installerSizeBytes) && <span className="text-neutral-500"> · {formatSize(latest.installerSizeBytes)}</span>}
                  </dd>
                </dl>
              </div>
              <a
                href="/api/desktop/download/latest"
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-5 py-3"
                data-testid="desktop-download"
              >
                <Download size={18} /> {t("landing.desktop.button")}
              </a>
            </div>
            {latest.sha256 && (
              <p className="mt-4 text-xs text-neutral-500 break-all flex items-start gap-1.5">
                <ShieldCheck size={14} className="shrink-0" /> SHA-256: <code>{latest.sha256}</code>
              </p>
            )}
            {latest.releaseNotes && (
              <div className="mt-4 border-t border-neutral-100 dark:border-neutral-800 pt-4">
                <h3 className="text-sm font-medium mb-1">{t("dl.whatsNew")}</h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap">{latest.releaseNotes}</p>
              </div>
            )}
          </section>
        ) : (
          <section className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-6 text-sm text-neutral-500" data-testid="desktop-unavailable">
            {unavailable ? `${t("dl.unavailable")} ` : ""}
            {t("dl.none")}
          </section>
        )}

        <section className="mt-8 text-sm text-neutral-600 dark:text-neutral-400 space-y-2">
          <h3 className="font-medium text-neutral-900 dark:text-neutral-100">{t("dl.installing")}</h3>
          <ol className="list-decimal pl-5 space-y-1">
            <li>{t("dl.step1")}</li>
            <li>{t("dl.step2")}</li>
            <li>{t("dl.step3")}</li>
          </ol>
          <p>{t("dl.requirements")}</p>
        </section>

        {previous.length > 0 && (
          <section className="mt-8">
            <h3 className="text-sm font-medium mb-2">{t("dl.previous")}</h3>
            <ul className="text-sm divide-y divide-neutral-100 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
              {previous.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-4 py-2">
                  <span>
                    v{r.version} <span className="text-neutral-500">· {formatDate(r.publishedAt)}</span>
                  </span>
                  <a href={r.installerUrl} className="text-indigo-600 hover:underline">
                    {t("common.download")}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
