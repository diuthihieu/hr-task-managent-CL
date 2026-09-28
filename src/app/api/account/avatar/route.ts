import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, route, badRequest, HttpError } from "@/lib/authz";
import { sniffLogoType } from "@/lib/workspace-logo";

const MAX_AVATAR_BYTES = 512 * 1024;

/** Upload / replace the caller's profile picture: multipart field `file` (PNG, JPEG or WebP, <= 512 KB). */
export const PUT = route(async (req) => {
  const user = await requireUser();
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw badRequest("Send the image as multipart form field `file`");
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!buf.length) throw badRequest("Image is empty");
  if (buf.length > MAX_AVATAR_BYTES) throw new HttpError(413, "Image is too large (max 512 KB)");
  const type = sniffLogoType(buf);
  if (!type) throw badRequest("Use a PNG, JPEG or WebP image");
  const u = await prisma.user.update({ where: { id: user.id }, data: { avatarData: Buffer.from(buf), avatarType: type, avatarUpdatedAt: new Date(), updatedById: user.id }, select: { avatarUpdatedAt: true } });
  return NextResponse.json({ avatarUrl: `/api/users/${user.id}/avatar?v=${u.avatarUpdatedAt!.getTime()}` });
});

export const DELETE = route(async () => {
  const user = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { avatarData: null, avatarType: null, avatarUpdatedAt: null, updatedById: user.id } });
  return new NextResponse(null, { status: 204 });
});
