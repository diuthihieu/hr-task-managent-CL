import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdmin, route, readJson } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { serializeRelease } from "@/lib/desktop-releases";

type P = { releaseId: string };

const schema = z.object({
  isPublished: z.boolean().optional(),
  releaseNotes: z.string().max(20000).nullable().optional(),
  minOsVersion: z.string().min(1).max(120).optional(),
});

/** Unpublish a bad build (the Download link falls back to the previous version) or edit notes. */
export const PATCH = route<P>(async (req, { params }) => {
  const admin = await requireAdmin();
  const { releaseId } = await params;
  const body = schema.parse(await readJson(req));
  const release = await prisma.$transaction(async (tx) => {
    const before = await tx.desktopRelease.findUniqueOrThrow({ where: { id: releaseId } });
    const r = await tx.desktopRelease.update({ where: { id: releaseId }, data: { ...body, updatedById: admin.id } });
    if (body.isPublished !== undefined && body.isPublished !== before.isPublished) {
      await logActivity(tx, { workspaceId: null, actorId: admin.id, entityType: "desktop_release", entityId: r.id, action: body.isPublished ? "published" : "unpublished", summary: `Desktop v${r.version}` });
    }
    return r;
  });
  return NextResponse.json(serializeRelease(release));
});
