import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { route, readJson, notFound, badRequest } from "@/lib/authz";
import { recoContext } from "@/lib/recognition/route-helpers";
import { notifyReachableRewards, requireRecognitionManager } from "@/lib/recognition/points";
import { REWARD_SELECT, rewardSchema, serializeReward } from "@/lib/recognition/rewards";

type P = { rewardId: string };

async function managed(rewardId: string) {
  const r = await prisma.reward.findFirst({ where: { id: rewardId, deletedAt: null }, select: { workspaceId: true, approvedCount: true } });
  if (!r) throw notFound("Reward");
  const { user, ctx } = await recoContext(r.workspaceId, { sync: false });
  await requireRecognitionManager(user, r.workspaceId, ctx.role);
  return r;
}

export const PATCH = route<P>(async (req, { params }) => {
  const { rewardId } = await params;
  const r = await managed(rewardId);
  const body = rewardSchema.partial().parse(await readJson(req));
  if (body.quantity !== undefined && body.quantity < r.approvedCount) throw badRequest(`Stock can't be lower than the ${r.approvedCount} already approved`);
  const row = await prisma.reward.update({ where: { id: rewardId }, data: { ...body, price: body.price === undefined ? undefined : body.price }, select: REWARD_SELECT });
  await notifyReachableRewards(r.workspaceId);
  return NextResponse.json(serializeReward(row));
});

/** Soft delete; pending requests for it are cancelled (their points are released). */
export const DELETE = route<P>(async (_req, { params }) => {
  const { rewardId } = await params;
  await managed(rewardId);
  await prisma.$transaction([
    prisma.reward.update({ where: { id: rewardId }, data: { deletedAt: new Date(), active: false } }),
    prisma.rewardRedemption.updateMany({ where: { rewardId, status: "pending" }, data: { status: "cancelled", decidedAt: new Date(), decisionNote: "Reward removed" } }),
  ]);
  return new NextResponse(null, { status: 204 });
});
