import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { route } from "@/lib/authz";
import { logActivity } from "@/lib/activity";
import { recoContext } from "@/lib/recognition/route-helpers";
import { requireRecognitionManager, syncPoints } from "@/lib/recognition/points";

type P = { workspaceId: string };

/** Recompute every member's points with the current rules (the ledger is rebuilt from activity). */
export const POST = route<P>(async (_req, { params }) => {
  const { workspaceId } = await params;
  const { user, ctx } = await recoContext(workspaceId, { sync: false });
  await requireRecognitionManager(user, workspaceId, ctx.role);
  await prisma.pointEvent.deleteMany({ where: { workspaceId } });
  const r = await syncPoints(workspaceId, { full: true });
  await logActivity(prisma, { workspaceId, actorId: user.id, entityType: "workspace", entityId: workspaceId, action: "updated", summary: `Recalculated recognition points (${r.added} events)` });
  return NextResponse.json(r);
});
