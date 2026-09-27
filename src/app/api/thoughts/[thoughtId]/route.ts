import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, workspaceOfThought, notFound } from "@/lib/authz";

type P = { thoughtId: string };

/** Archive (dismiss) one of your own captured thoughts. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { thoughtId } = await params;
  await requireWorkspaceRole(user, await workspaceOfThought(thoughtId), "contributor");
  const t = await prisma.capturedThought.findUnique({ where: { id: thoughtId } });
  if (!t || t.userId !== user.id) throw notFound("Thought");
  await prisma.capturedThought.update({ where: { id: thoughtId }, data: { status: "archived" } });
  return new NextResponse(null, { status: 204 });
});
