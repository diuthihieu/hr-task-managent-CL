// Where release installers / update packages may be downloaded from (BUG-26).
// A host list (github.com, any public Vercel Blob store) let a release point at
// any repository's files; only the URL prefixes of our own releases are allowed:
// DESKTOP_ARTIFACT_PREFIXES (comma list), or this repository's GitHub releases -
// the URLs desktop-build.yml / android.yml register. Pure, unit tested.

const DEFAULT_PREFIX = "https://github.com/diuthihieu/hr-task-managent-CL/releases/download/";

export function artifactPrefixes(env: Record<string, string | undefined> = process.env): string[] {
  const list = (env.DESKTOP_ARTIFACT_PREFIXES ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  return list.length ? list : [DEFAULT_PREFIX];
}

/**
 * Checked on the raw string first: `new URL()` resolves "..", "%2e%2e" and "\",
 * so a normalised URL would already have escaped the prefix unnoticed.
 */
export function allowedArtifactUrl(raw: string, prefixes: string[]): boolean {
  if (!prefixes.length) return false;
  if (/\.\.|\\|@|%2e|%2f|%5c/i.test(raw)) return false;
  let href: string;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return false;
    href = url.href;
  } catch {
    return false;
  }
  return prefixes.some((p) => href.startsWith(p.endsWith("/") ? p : `${p}/`));
}
