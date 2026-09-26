import { NextResponse } from "next/server";
import { route } from "@/lib/authz";
import { buildUpdaterManifest, getPublishedReleases, PLATFORMS } from "@/lib/desktop-releases";

type P = { target: string; arch: string; currentVersion: string };

/**
 * Tauri updater endpoint:
 *   {server}/api/desktop/update/{{target}}/{{arch}}/{{current_version}}
 * 204 = up to date. Only releases with an updater URL + signature are offered,
 * so updates stay off until release signing is configured.
 */
export const GET = route<P>(async (req, { params }) => {
  const { target, arch, currentVersion } = await params;
  const platform = `${target}-${arch}`;
  if (!(PLATFORMS as readonly string[]).includes(platform)) return new NextResponse(null, { status: 204 });
  const channel = new URL(req.url).searchParams.get("channel") === "beta" ? "beta" : "stable";
  const manifest = buildUpdaterManifest(await getPublishedReleases(platform, channel), currentVersion);
  if (!manifest) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(manifest, { headers: { "Cache-Control": "no-store" } });
});
