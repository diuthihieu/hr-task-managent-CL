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
