import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

export const rewardSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  pointsCost: z.number().int().min(1).max(10_000_000),
  price: z.number().min(0).max(1e12).nullable().optional(),
  currency: z.string().trim().min(1).max(8).default("VND"),
  quantity: z.number().int().min(0).max(1_000_000),
  active: z.boolean().default(true),
});

export const REWARD_SELECT = {
  id: true,
  name: true,
  description: true,
  pointsCost: true,
  price: true,
  currency: true,
  quantity: true,
  approvedCount: true,
  active: true,
  sortOrder: true,
  updatedAt: true,
  imageMimeType: true,
  _count: { select: { redemptions: { where: { status: "pending" as const } } } },
} satisfies Prisma.RewardSelect;

type Row = Prisma.RewardGetPayload<{ select: typeof REWARD_SELECT }>;

export function serializeReward(r: Row) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    pointsCost: r.pointsCost,
    price: r.price === null ? null : Number(r.price),
    currency: r.currency,
    quantity: r.quantity,
    approvedCount: r.approvedCount,
    remaining: Math.max(0, r.quantity - r.approvedCount),
    soldOut: r.approvedCount >= r.quantity,
    pending: r._count.redemptions,
    active: r.active,
    imageUrl: r.imageMimeType ? `/api/rewards/${r.id}/image?v=${r.updatedAt.getTime()}` : null,
  };
}
export type RewardDto = ReturnType<typeof serializeReward>;
