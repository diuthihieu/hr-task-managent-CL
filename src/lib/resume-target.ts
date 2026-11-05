// Where a signed-in person lands when they open woli again (installed app, the site root, after signing
// in): the workspace they last had open - Home on a computer, the "All" page on a phone. Pure, so it is
// unit tested; the server checks membership before using it (see last-workspace.ts).

/** Cookie holding the slug of the workspace last opened on this device (set by proxy.ts). */
export const LAST_WORKSPACE_COOKIE = "woli_last_ws";

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

export function isWorkspaceSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG.test(value);
}

/** Phones only: tablets and computers get the desktop layout (the phone tab bar is for phones). */
export function isPhone(userAgent: string | null | undefined, chMobile?: string | null): boolean {
  if (chMobile === "?1") return true;
  const ua = userAgent ?? "";
  return /iPhone|iPod|Windows Phone/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua));
}

/** The page to open in a workspace on this device. */
export function workspaceLanding(slug: string, phone: boolean): string {
  return phone ? `/w/${slug}/apps` : `/w/${slug}`;
}

/** The workspace slug a /w/... path is in, if any. */
export function workspaceSlugOf(path: string): string | null {
  const m = /^\/w\/([^/?#]+)/.exec(path);
  return m && isWorkspaceSlug(m[1]) ? m[1] : null;
}

/** Cookie attributes for LAST_WORKSPACE_COOKIE (a year; readable by the page so client-side workspace changes update it too). */
export const LAST_WORKSPACE_MAX_AGE = 60 * 60 * 24 * 365;

/** Remembers `slug` from the browser (client-side navigation, e.g. Back to a cached workspace page, never reaches proxy.ts). */
export function rememberWorkspaceInBrowser(slug: string) {
  if (typeof document === "undefined" || !isWorkspaceSlug(slug)) return;
  const current = document.cookie.split("; ").find((c) => c.startsWith(`${LAST_WORKSPACE_COOKIE}=`))?.slice(LAST_WORKSPACE_COOKIE.length + 1);
  if (current === slug) return;
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${LAST_WORKSPACE_COOKIE}=${slug}; path=/; max-age=${LAST_WORKSPACE_MAX_AGE}; samesite=lax${secure}`;
}
