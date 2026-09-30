import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { route, forbidden } from "@/lib/authz";
import { recoContext } from "@/lib/recognition/route-helpers";

type P = { workspaceId: string };

/** Points history (ledger) of the caller, or of ?userId= for people allowed to see others' points. */
export const GET = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user, seePoints } = await recoContext(workspaceId);
  const userId = new URL(req.url).searchParams.get("userId") ?? user.id;
  if (userId !== user.id && !seePoints) throw forbidden("You can't see other members' points");
  const [events, byAction] = await Promise.all([
    prisma.pointEvent.findMany({ where: { workspaceId, userId }, orderBy: { occurredAt: "desc" }, take: 100, select: { id: true, action: true, points: true, occurredAt: true, sourceId: true } }),
    prisma.pointEvent.groupBy({ by: ["action"], where: { workspaceId, userId }, _sum: { points: true }, _count: { _all: true } }),
  ]);
  return NextResponse.json({
    events: events.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
    byAction: byAction.map((a) => ({ action: a.action, points: a._sum.points ?? 0, count: a._count._all })),
  });
});
