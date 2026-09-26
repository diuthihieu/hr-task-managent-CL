// Desktop release registry: pure helpers (semver, updater manifest) plus
// the database reads used by the Download page, the "latest" redirect and
// the Tauri updater endpoint. There is exactly one source of truth - the
// `desktop_releases` table - so the web download link and the in-app updater
// can never disagree about what "latest" means.

import type { DesktopRelease, ReleaseChannel } from "@prisma/client";
import { prisma } from "./prisma";

export const DEFAULT_PLATFORM = "windows-x86_64";
export const PLATFORMS = ["windows-x86_64"] as const;
export const DESKTOP_UA_TOKEN = "BaseworkDesktop";

// ---------------------------------------------------------------------------
// Semantic versions (MAJOR.MINOR.PATCH[-prerelease])
// ---------------------------------------------------------------------------

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

export function isSemver(v: string): boolean {
  return SEMVER_RE.test(v);
}

/** Negative if a < b, 0 if equal, positive if a > b. Prereleases sort before their release. */
export function compareSemver(a: string, b: string): number {
  const pa = SEMVER_RE.exec(a.replace(/^v/, ""));
  const pb = SEMVER_RE.exec(b.replace(/^v/, ""));
  if (!pa || !pb) throw new Error(`Invalid version: ${!pa ? a : b}`);
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i]);
    if (d !== 0) return d;
  }
  const ra = pa[4];
  const rb = pb[4];
  if (ra === rb) return 0;
  if (!ra) return 1;
  if (!rb) return -1;
  const ia = ra.split(".");
  const ib = rb.split(".");
  for (let i = 0; i < Math.max(ia.length, ib.length); i++) {
    if (ia[i] === undefined) return -1;
    if (ib[i] === undefined) return 1;
    const na = /^\d+$/.test(ia[i]) ? Number(ia[i]) : NaN;
    const nb = /^\d+$/.test(ib[i]) ? Number(ib[i]) : NaN;
    if (!Number.isNaN(na) && !Number.isNaN(nb)) {
      if (na !== nb) return na - nb;
    } else if (ia[i] !== ib[i]) {
      return ia[i] < ib[i] ? -1 : 1;
    }
  }
  return 0;
}

/** Highest version among the given releases (not the most recently inserted one). */
export function pickLatest<T extends { version: string }>(releases: T[]): T | null {
  return releases.reduce<T | null>((best, r) => (!best || compareSemver(r.version, best.version) > 0 ? r : best), null);
}

// ---------------------------------------------------------------------------
// Tauri updater manifest
// https://v2.tauri.app/plugin/updater/ - dynamic update server response
// ---------------------------------------------------------------------------

export interface UpdaterManifest {
  version: string;
  notes: string;
  pub_date: string;
  url: string;
  signature: string;
}

/** The manifest to return, or null for "no update" (HTTP 204). Releases without a signature are never offered. */
export function buildUpdaterManifest(
  releases: Pick<DesktopRelease, "version" | "releaseNotes" | "publishedAt" | "updaterUrl" | "updaterSignature">[],
  currentVersion: string
): UpdaterManifest | null {
  const signed = releases.filter((r) => r.updaterUrl && r.updaterSignature);
  const latest = pickLatest(signed);
  if (!latest || !isSemver(currentVersion) || compareSemver(latest.version, currentVersion) <= 0) return null;
  return {
    version: latest.version,
    notes: latest.releaseNotes ?? "",
    pub_date: latest.publishedAt.toISOString(),
    url: latest.updaterUrl!,
    signature: latest.updaterSignature!,
  };
}

// ---------------------------------------------------------------------------
// Database reads
// ---------------------------------------------------------------------------

export async function getPublishedReleases(platform = DEFAULT_PLATFORM, channel: ReleaseChannel = "stable") {
  return prisma.desktopRelease.findMany({ where: { platform, channel, isPublished: true }, orderBy: { publishedAt: "desc" } });
}

export async function getLatestRelease(platform = DEFAULT_PLATFORM, channel: ReleaseChannel = "stable") {
  return pickLatest(await getPublishedReleases(platform, channel));
}

export interface DesktopReleaseDto {
  id: string;
  version: string;
  platform: string;
  channel: string;
  installerFileName: string;
  installerSizeBytes: number | null;
  sha256: string | null;
  minOsVersion: string;
  releaseNotes: string | null;
  publishedAt: string;
  isPublished: boolean;
  downloadUrl: string;
  updaterReady: boolean;
}

export function serializeRelease(r: DesktopRelease): DesktopReleaseDto {
  return {
    id: r.id,
    version: r.version,
    platform: r.platform,
    channel: r.channel,
    installerFileName: r.installerFileName,
    installerSizeBytes: r.installerSizeBytes === null ? null : Number(r.installerSizeBytes),
    sha256: r.sha256,
    minOsVersion: r.minOsVersion,
    releaseNotes: r.releaseNotes,
    publishedAt: r.publishedAt.toISOString(),
    isPublished: r.isPublished,
    downloadUrl: r.installerUrl,
    updaterReady: Boolean(r.updaterUrl && r.updaterSignature),
  };
}

/** Desktop client detection from the User-Agent the Tauri shell sets ("... BaseworkDesktop/1.2.0"). */
export function desktopVersionFromUserAgent(ua: string | null | undefined): string | null {
  const m = ua?.match(new RegExp(`${DESKTOP_UA_TOKEN}/([0-9A-Za-z.+-]+)`));
  return m ? m[1] : null;
}
