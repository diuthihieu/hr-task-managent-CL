import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { route, notFound, badRequest, requireUser, requireWorkspaceRole } from "@/lib/authz";
import { recoContext } from "@/lib/recognition/route-helpers";
import { requireRecognitionManager } from "@/lib/recognition/points";
import { sniffLogoType } from "@/lib/workspace-logo";

type P = { rewardId: string };

const MAX = 1024 * 1024;

export const GET = route<P>(async (_req, { params }) => {
  const { rewardId } = await params;
  const user = await requireUser();
  const r = await prisma.reward.findFirst({ where: { id: rewardId, deletedAt: null }, select: { workspaceId: true, imageData: true, imageMimeType: true } });
  if (!r?.imageData) throw notFound("Image");
  await requireWorkspaceRole(user, r.workspaceId, "viewer");
  return new Response(new Uint8Array(r.imageData), { headers: { "Content-Type": r.imageMimeType ?? "image/png", "Cache-Control": "private, max-age=86400" } });
});

async function managedReward(rewardId: string) {
  const r = await prisma.reward.findFirst({ where: { id: rewardId, deletedAt: null }, select: { workspaceId: true } });
  if (!r) throw notFound("Reward");
  const { user, ctx } = await recoContext(r.workspaceId, { sync: false });
  await requireRecognitionManager(user, r.workspaceId, ctx.role);
  return r;
}

/** Upload the reward's picture (PNG / JPEG / WebP, max 1 MB; the browser downsizes photos before upload). */
export const PUT = route<P>(async (req, { params }) => {
  const { rewardId } = await params;
  await managedReward(rewardId);
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw badRequest("Send the image as 'file'");
  const buf = new Uint8Array(await file.arrayBuffer());
  if (!buf.length || buf.length > MAX) throw badRequest("Image must be between 1 byte and 1 MB");
  const type = sniffLogoType(buf);
  if (!type) throw badRequest("Image must be a PNG, JPEG or WebP");
  await prisma.reward.update({ where: { id: rewardId }, data: { imageData: Buffer.from(buf), imageMimeType: type } });
  return NextResponse.json({ ok: true });
});

/** Remove the picture (the catalog falls back to the gift icon). */
export const DELETE = route<P>(async (_req, { params }) => {
  const { rewardId } = await params;
  await managedReward(rewardId);
  await prisma.reward.update({ where: { id: rewardId }, data: { imageData: null, imageMimeType: null } });
  return new NextResponse(null, { status: 204 });
});
