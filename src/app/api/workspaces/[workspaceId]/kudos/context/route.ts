import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { route, badRequest } from "@/lib/authz";
import { recoContext } from "@/lib/recognition/route-helpers";
import { kudosContext } from "@/lib/recognition/kudos-context";

type P = { workspaceId: string };

/** Facts about the caller's work with ?toId= (no AI): suggestions for what to thank them for. */
export const GET = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user } = await recoContext(workspaceId, { sync: false });
  const toId = new URL(req.url).searchParams.get("toId");
  if (!toId || !(await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId: toId } } }))) throw badRequest("Unknown receiver");
  const { facts } = await kudosContext(user, workspaceId, toId);
  return NextResponse.json({ facts });
});
