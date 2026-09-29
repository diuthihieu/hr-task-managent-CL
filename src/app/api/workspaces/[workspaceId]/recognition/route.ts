import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/authz";
import { recoContext } from "@/lib/recognition/route-helpers";
import { pointBalances } from "@/lib/recognition/points";

type P = { workspaceId: string };

/** Recognition overview for the caller: their points balance, permissions, next reward, unread kudos. */
export const GET = route<P>(async (_req, { params }) => {
  const { workspaceId } = await params;
  const { user, canManage, seePoints, settings } = await recoContext(workspaceId);
  const [balances, rewards, unreadKudos, received] = await Promise.all([
    pointBalances(prisma, workspaceId, [user.id]),
    prisma.reward.findMany({ where: { workspaceId, active: true, deletedAt: null }, select: { id: true, name: true, pointsCost: true, quantity: true, approvedCount: true }, orderBy: { pointsCost: "asc" } }),
    prisma.kudos.count({ where: { workspaceId, toId: user.id, deletedAt: null, readAt: null } }),
    prisma.kudos.count({ where: { workspaceId, toId: user.id, deletedAt: null } }),
  ]);
  const me = balances.get(user.id) ?? { earned: 0, pending: 0, spent: 0, balance: 0 };
  const next = rewards.find((r) => r.approvedCount < r.quantity && r.pointsCost > me.balance) ?? null;
  return NextResponse.json({
    enabled: settings.enabled,
    canManage,
    canSeeOthersPoints: seePoints,
    points: me,
    nextReward: next ? { id: next.id, name: next.name, pointsCost: next.pointsCost, missing: next.pointsCost - me.balance } : null,
    affordable: rewards.filter((r) => r.approvedCount < r.quantity && r.pointsCost <= me.balance).length,
    unreadKudos,
    kudosReceived: received,
  });
});
