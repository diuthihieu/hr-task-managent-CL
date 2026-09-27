import Link from "next/link";
import { headers } from "next/headers";
import { Monitor, Download, ShieldCheck, ArrowLeft, Info } from "lucide-react";
import { getPublishedReleases, pickLatest, compareSemver, desktopVersionFromUserAgent, DEFAULT_PLATFORM } from "@/lib/desktop-releases";

export const dynamic = "force-dynamic";
export const metadata = { title: "Download Basework for Windows" };

function formatSize(bytes: bigint | null) {
  if (bytes === null) return null;
  return `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
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

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 mb-6">
          <ArrowLeft size={14} /> Back to Basework
        </Link>

        <div className="flex items-start gap-4 mb-8">
          <div className="h-12 w-12 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0">
            <Monitor size={24} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Basework for Windows</h1>
            <p className="text-sm text-neutral-500 mt-1">
              The desktop app signs in to the same account and shows the same projects, tasks, goals, comments and files as the web app - everything is stored on the
              server, nothing only on your PC.
            </p>
          </div>
        </div>

        {runningVersion && (
          <div className="mb-6 rounded-lg border border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 px-4 py-3 text-sm flex items-start gap-2">
            <Info size={16} className="text-indigo-600 shrink-0 mt-0.5" />
            <span>
              You are using the desktop app, version <b>{runningVersion}</b>.
              {outdated ? ` Version ${latest!.version} is available - download it below and run the installer to update.` : " It is up to date."}
            </span>
          </div>
        )}

        {latest ? (
          <section className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6" aria-labelledby="latest-heading">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 justify-between">
              <div>
                <h2 id="latest-heading" className="text-lg font-semibold">
                  Version <span data-testid="desktop-version">{latest.version}</span>
                </h2>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-neutral-500">Released</dt>
                  <dd data-testid="desktop-release-date">{formatDate(latest.publishedAt)}</dd>
                  <dt className="text-neutral-500">Supported OS</dt>
                  <dd data-testid="desktop-os">{latest.minOsVersion}</dd>
                  <dt className="text-neutral-500">File</dt>
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
                <Download size={18} /> Download for Windows
              </a>
            </div>
            {latest.sha256 && (
              <p className="mt-4 text-xs text-neutral-500 break-all flex items-start gap-1.5">
                <ShieldCheck size={14} className="shrink-0" /> SHA-256: <code>{latest.sha256}</code>
              </p>
            )}
            {latest.releaseNotes && (
              <div className="mt-4 border-t border-neutral-100 dark:border-neutral-800 pt-4">
                <h3 className="text-sm font-medium mb-1">What&apos;s new</h3>
                <p className="text-sm text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap">{latest.releaseNotes}</p>
              </div>
            )}
          </section>
        ) : (
          <section className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-6 text-sm text-neutral-500" data-testid="desktop-unavailable">
            {unavailable ? "The desktop installer isn't available yet. " : ""}No desktop release has been published yet. Use the web app in the meantime - it has
            the same features and data.
          </section>
        )}

        <section className="mt-8 text-sm text-neutral-600 dark:text-neutral-400 space-y-2">
          <h3 className="font-medium text-neutral-900 dark:text-neutral-100">Installing</h3>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Run the downloaded installer. It installs per-user and needs no administrator rights.</li>
            <li>If Windows SmartScreen shows &quot;Windows protected your PC&quot;, choose <i>More info → Run anyway</i> (until the installer is code-signed).</li>
            <li>Open Basework from the Start menu and sign in with your usual account.</li>
          </ol>
          <p>Requires an internet connection. The app uses Microsoft Edge WebView2, which is built into Windows 10 (1803+) and Windows 11; the installer adds it if missing.</p>
        </section>

        {previous.length > 0 && (
          <section className="mt-8">
            <h3 className="text-sm font-medium mb-2">Previous versions</h3>
            <ul className="text-sm divide-y divide-neutral-100 dark:divide-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
              {previous.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-4 py-2">
                  <span>
                    v{r.version} <span className="text-neutral-500">· {formatDate(r.publishedAt)}</span>
                  </span>
                  <a href={r.installerUrl} className="text-indigo-600 hover:underline">
                    Download
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
