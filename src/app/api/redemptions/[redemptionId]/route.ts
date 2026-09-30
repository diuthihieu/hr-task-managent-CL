import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson, notFound, badRequest, forbidden } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { recoContext } from "@/lib/recognition/route-helpers";
import { requireRecognitionManager } from "@/lib/recognition/points";

type P = { redemptionId: string };

const schema = z.object({ action: z.enum(["approve", "reject", "cancel"]), note: z.string().trim().max(1000).optional() });

/**
 * Managers approve / reject a request; the requester can cancel while pending.
 * Approving takes one unit of stock atomically - once the stock is used up
 * every further approval fails with "out of stock".
 */
export const PATCH = route<P>(async (req, { params }) => {
  const { redemptionId } = await params;
  const red = await prisma.rewardRedemption.findUnique({ where: { id: redemptionId }, include: { reward: { select: { name: true } } } });
  if (!red) throw notFound("Request");
  const { user, ctx, base } = await recoContext(red.workspaceId, { sync: false });
  const body = schema.parse(await readJson(req));
  if (red.status !== "pending") throw badRequest("This request was already decided");
  if (body.action === "cancel") {
    if (red.userId !== user.id) throw forbidden("Only the requester can cancel");
  } else await requireRecognitionManager(user, red.workspaceId, ctx.role);

  await prisma.$transaction(async (tx) => {
    if (body.action === "approve") {
      const took = await tx.$executeRaw`UPDATE rewards SET approved_count = approved_count + 1, updated_at = now() WHERE id = ${red.rewardId}::uuid AND approved_count < quantity AND deleted_at IS NULL`;
      if (!took) throw badRequest("Out of stock: every unit of this reward has already been given");
    }
    const status = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "cancelled";
    const n = await tx.rewardRedemption.updateMany({ where: { id: redemptionId, status: "pending" }, data: { status, decisionNote: body.note || null, decidedById: user.id, decidedAt: new Date() } });
    if (!n.count) throw badRequest("This request was already decided");
    if (body.action !== "cancel")
      await tx.notification.create({ data: { userId: red.userId, workspaceId: red.workspaceId, actorId: user.id, type: "reward_result", title: red.reward.name, body: body.note || null, data: { decision: status }, link: `${base}/recognition?tab=rewards` } });
    await logActivity(tx, { workspaceId: red.workspaceId, actorId: user.id, entityType: "workspace", entityId: red.workspaceId, action: "updated", summary: `Reward request "${red.reward.name}" ${status}` });
  });
  return NextResponse.json({ id: redemptionId, status: body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "cancelled" });
});
