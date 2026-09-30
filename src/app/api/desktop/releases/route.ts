import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, route, readJson } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { requireReleasePublisher } from "@/lib/release-auth";
import { PLATFORMS, serializeRelease } from "@/lib/desktop-releases";

/** Every release incl. unpublished ones (Admin console). */
export const GET = route(async () => {
  await requireAdmin();
  const rows = await prisma.desktopRelease.findMany({ orderBy: [{ publishedAt: "desc" }] });
  return NextResponse.json(rows.map(serializeRelease));
});

const https = z.string().url().regex(/^https:\/\//, "must be an https:// URL");
/** Installers may only be served from these hosts (comma list in DESKTOP_ARTIFACT_HOSTS; "*." allows subdomains). */
const ARTIFACT_HOSTS = (process.env.DESKTOP_ARTIFACT_HOSTS ?? "github.com,objects.githubusercontent.com,*.public.blob.vercel-storage.com").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
const allowedHost = (url: string) => {
  const host = new URL(url).hostname.toLowerCase();
  return ARTIFACT_HOSTS.some((h) => (h.startsWith("*.") ? host.endsWith(h.slice(1)) : host === h));
};
const artifactUrl = https.refine(allowedHost, "host is not an allowed artifact host (DESKTOP_ARTIFACT_HOSTS)");
const publishSchema = z.object({
  version: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/, "must be a semantic version like 1.2.0"),
  platform: z.enum(PLATFORMS).default("windows-x86_64"),
  channel: z.enum(["stable", "beta"]).default("stable"),
  installerUrl: artifactUrl,
  installerFileName: z.string().min(1).max(255),
  installerSizeBytes: z.number().int().nonnegative().optional(),
  /** Required: clients and the download page show it so the installer can be verified. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  updaterUrl: https.optional(),
  updaterSignature: z.string().min(1).max(4000).optional(),
  minOsVersion: z.string().min(1).max(120).optional(),
  releaseNotes: z.string().max(20000).optional(),
  publishedAt: z.string().datetime().optional(),
  isPublished: z.boolean().default(true),
});

/**
 * Register (or re-register) a release. Called by the desktop CI workflow after
 * the installer is uploaded; idempotent per (platform, channel, version).
 */
export const POST = route(async (req) => {
  const actorId = await requireReleasePublisher(req);
  const body = publishSchema.parse(await readJson(req));
  const data = {
    installerUrl: body.installerUrl,
    installerFileName: body.installerFileName,
    installerSizeBytes: body.installerSizeBytes === undefined ? null : BigInt(body.installerSizeBytes),
    sha256: body.sha256 ?? null,
    updaterUrl: body.updaterUrl ?? null,
    updaterSignature: body.updaterSignature ?? null,
    ...(body.minOsVersion ? { minOsVersion: body.minOsVersion } : {}),
    releaseNotes: body.releaseNotes ?? null,
    isPublished: body.isPublished,
    ...(body.publishedAt ? { publishedAt: new Date(body.publishedAt) } : {}),
    updatedById: actorId,
  };
  const release = await prisma.$transaction(async (tx) => {
    const r = await tx.desktopRelease.upsert({
      where: { platform_channel_version: { platform: body.platform, channel: body.channel, version: body.version } },
      create: { version: body.version, platform: body.platform, channel: body.channel, ...data, createdById: actorId },
      update: data,
    });
    await logActivity(tx, {
      workspaceId: null,
      actorId,
      entityType: "desktop_release",
      entityId: r.id,
      action: body.isPublished ? "published" : "updated",
      summary: `Desktop ${r.platform} ${r.channel} v${r.version}${actorId ? "" : " (CI)"}`,
    });
    return r;
  });
  return NextResponse.json(serializeRelease(release), { status: 201 });
});
