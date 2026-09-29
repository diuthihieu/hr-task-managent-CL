import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson, notFound, badRequest } from "@/lib/authz";
import { recoContext } from "@/lib/recognition/route-helpers";
import { pointBalances } from "@/lib/recognition/points";

type P = { rewardId: string };

/**
 * Ask for a reward. Needs enough points (earned - reserved - spent) and stock;
 * the points are reserved until a manager approves (spent) or rejects (released).
 */
export const POST = route<P>(async (req, { params }) => {
  const { rewardId } = await params;
  const reward = await prisma.reward.findFirst({ where: { id: rewardId, deletedAt: null, active: true } });
  if (!reward) throw notFound("Reward");
  const { user, base } = await recoContext(reward.workspaceId);
  const { note } = z.object({ note: z.string().trim().max(1000).optional() }).parse(await readJson(req));
  if (reward.approvedCount >= reward.quantity) throw badRequest("This reward is out of stock");
  const red = await prisma.$transaction(async (tx) => {
    // Serialize a member's requests so two tabs can't spend the same points.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`reco:${reward.workspaceId}:${user.id}`}))`;
    const b = (await pointBalances(tx, reward.workspaceId, [user.id])).get(user.id) ?? { balance: 0 };
    if (b.balance < reward.pointsCost) throw badRequest(`Not enough points: you have ${b.balance}, this reward needs ${reward.pointsCost}`);
    return tx.rewardRedemption.create({ data: { workspaceId: reward.workspaceId, rewardId, userId: user.id, points: reward.pointsCost, note: note || null } });
  });
  // Tell the people who approve.
  const admins = await prisma.workspaceMember.findMany({ where: { workspaceId: reward.workspaceId, role: { in: ["owner", "admin"] } }, select: { userId: true } });
  const managers = await prisma.recognitionManager.findMany({ where: { workspaceId: reward.workspaceId }, select: { userId: true } });
  const to = [...new Set([...admins, ...managers].map((m) => m.userId))].filter((id) => id !== user.id);
  await prisma.notification.createMany({ data: to.map((userId) => ({ userId, workspaceId: reward.workspaceId, actorId: user.id, type: "reward_request", title: reward.name, body: note || null, link: `${base}/recognition?tab=manage` })) });
  return NextResponse.json({ id: red.id, status: red.status, points: red.points }, { status: 201 });
});
