import { NextResponse } from "next/server";
import { route } from "@/lib/authz";
import { getLatestRelease, DEFAULT_PLATFORM } from "@/lib/desktop-releases";

/**
 * Stable "always the latest installer" link used by the Download button.
 * Redirects to the hosted installer, so publishing a new release never
 * requires changing any link in the web app.
 */
export const GET = route(async (req) => {
  const url = new URL(req.url);
  const channel = url.searchParams.get("channel") === "beta" ? "beta" : "stable";
  const latest = await getLatestRelease(url.searchParams.get("platform") ?? DEFAULT_PLATFORM, channel);
  if (!latest) return NextResponse.redirect(new URL("/download?unavailable=1", url), 302);
  return NextResponse.redirect(latest.installerUrl, { status: 302, headers: { "Cache-Control": "no-store" } });
});
