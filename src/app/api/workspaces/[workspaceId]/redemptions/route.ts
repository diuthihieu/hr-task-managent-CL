import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/authz";
import { recoContext } from "@/lib/recognition/route-helpers";

type P = { workspaceId: string };

/** Reward requests: the caller's own (?mine=1, default for members) or everyone's (managers). */
export const GET = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user, canManage } = await recoContext(workspaceId, { sync: false });
  const mine = new URL(req.url).searchParams.get("mine") === "1" || !canManage;
  const rows = await prisma.rewardRedemption.findMany({
    where: { workspaceId, ...(mine ? { userId: user.id } : {}) },
    include: { reward: { select: { id: true, name: true, quantity: true, approvedCount: true } }, user: { select: { id: true, name: true, avatarColor: true } } },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      status: r.status,
      points: r.points,
      note: r.note,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      reward: { ...r.reward, remaining: Math.max(0, r.reward.quantity - r.reward.approvedCount) },
      user: r.user,
    }))
  );
});
