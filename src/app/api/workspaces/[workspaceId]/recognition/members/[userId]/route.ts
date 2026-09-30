import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson, notFound } from "@/lib/authz";
import { recoContext } from "@/lib/recognition/route-helpers";
import { requireRecognitionManager } from "@/lib/recognition/points";

type P = { workspaceId: string; userId: string };

/** Show or hide other people's points for one member (null = use the workspace default). */
export const PUT = route<P>(async (req, { params }) => {
  const { workspaceId, userId } = await params;
  const { user, ctx } = await recoContext(workspaceId, { sync: false });
  await requireRecognitionManager(user, workspaceId, ctx.role);
  const { canViewOthersPoints } = z.object({ canViewOthersPoints: z.boolean().nullable() }).parse(await readJson(req));
  if (!(await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } }))) throw notFound("Member");
  if (canViewOthersPoints === null) await prisma.recognitionMember.deleteMany({ where: { workspaceId, userId } });
  else await prisma.recognitionMember.upsert({ where: { workspaceId_userId: { workspaceId, userId } }, create: { workspaceId, userId, canViewOthersPoints }, update: { canViewOthersPoints } });
  return NextResponse.json({ userId, canViewOthersPoints });
});
