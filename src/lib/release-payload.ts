// Release platforms and the Admin console's "Register release" payload.
// Pure (no Prisma, no server-only) so the client dialog and unit tests can
// import it; desktop-releases.ts re-exports the platform lists.

export const DEFAULT_PLATFORM = "windows-x86_64";
/** Platforms the Tauri desktop updater serves. */
export const DESKTOP_PLATFORMS = ["windows-x86_64"] as const;
/** Every platform a release can be registered for: the desktop app and the Android app (APK). */
export const PLATFORMS = [...DESKTOP_PLATFORMS, "android"] as const;
export type ReleasePlatform = (typeof PLATFORMS)[number];

export class ReleasePayloadError extends Error {
  constructor(readonly field: "installerUrl" | "sha256" | "platform") {
    super(`invalid ${field}`);
  }
}

export interface ReleaseForm {
  version: string;
  installerUrl: string;
  sha256: string;
  platform: string;
  notes: string;
}

/**
 * Body for POST /api/desktop/releases. The API still validates everything;
 * this only normalises what people paste (a leading "v", Get-FileHash's
 * upper-case hash, stray spaces) and catches a bad hash before the request.
 */
export function buildReleasePayload(form: ReleaseForm) {
  const installerUrl = form.installerUrl.trim();
  let path: string;
  try {
    const url = new URL(installerUrl);
    if (url.protocol !== "https:") throw new ReleasePayloadError("installerUrl");
    path = url.pathname;
  } catch {
    throw new ReleasePayloadError("installerUrl");
  }
  const sha256 = form.sha256.replace(/\s+/g, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new ReleasePayloadError("sha256");
  if (!(PLATFORMS as readonly string[]).includes(form.platform)) throw new ReleasePayloadError("platform");
  const notes = form.notes.trim();
  return {
    version: form.version.trim().replace(/^v/, ""),
    platform: form.platform as ReleasePlatform,
    installerUrl,
    installerFileName: decodeURIComponent(path.split("/").pop() || "installer"),
    sha256,
    releaseNotes: notes || undefined,
  };
}
