import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { recoContext } from "@/lib/recognition/route-helpers";
import { notifyReachableRewards, requireRecognitionManager } from "@/lib/recognition/points";
import { REWARD_SELECT, rewardSchema, serializeReward } from "@/lib/recognition/rewards";

type P = { workspaceId: string };

/** Reward catalog (members see active rewards; managers also inactive ones). */
export const GET = route<P>(async (_req, { params }) => {
  const { workspaceId } = await params;
  const { canManage } = await recoContext(workspaceId, { sync: false });
  const rows = await prisma.reward.findMany({ where: { workspaceId, deletedAt: null, ...(canManage ? {} : { active: true }) }, select: REWARD_SELECT, orderBy: [{ sortOrder: "asc" }, { pointsCost: "asc" }] });
  return NextResponse.json(rows.map(serializeReward));
});

/** Add one reward or many at once ({ items: [...] }). */
export const POST = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user, ctx } = await recoContext(workspaceId, { sync: false });
  await requireRecognitionManager(user, workspaceId, ctx.role);
  const raw = await readJson<Record<string, unknown>>(req);
  const items = raw && Array.isArray(raw.items) ? z.array(rewardSchema).min(1).max(200).parse(raw.items) : [rewardSchema.parse(raw)];
  const last = await prisma.reward.aggregate({ where: { workspaceId }, _max: { sortOrder: true } });
  const created = await prisma.$transaction(async (tx) => {
    const out = [];
    for (const [i, it] of items.entries()) out.push(await tx.reward.create({ data: { workspaceId, ...it, price: it.price ?? null, sortOrder: (last._max.sortOrder ?? 0) + i + 1, createdById: user.id }, select: REWARD_SELECT }));
    await logActivity(tx, { workspaceId, actorId: user.id, entityType: "workspace", entityId: workspaceId, action: "updated", summary: `Added ${out.length} reward(s)` });
    return out;
  });
  await notifyReachableRewards(workspaceId);
  return NextResponse.json(items.length === 1 && !(raw && Array.isArray(raw.items)) ? serializeReward(created[0]) : created.map(serializeReward), { status: 201 });
});
