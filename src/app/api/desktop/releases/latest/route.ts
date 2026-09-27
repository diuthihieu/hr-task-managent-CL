import { NextResponse } from "next/server";
import { route, notFound } from "@/lib/authz";
import { getLatestRelease, serializeRelease, DEFAULT_PLATFORM } from "@/lib/desktop-releases";

/** Public: metadata of the newest published installer (version, OS, date, size, checksum). */
export const GET = route(async (req) => {
  const url = new URL(req.url);
  const channel = url.searchParams.get("channel") === "beta" ? "beta" : "stable";
  const latest = await getLatestRelease(url.searchParams.get("platform") ?? DEFAULT_PLATFORM, channel);
  if (!latest) throw notFound("Desktop release");
  return NextResponse.json(serializeRelease(latest), { headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } });
});
