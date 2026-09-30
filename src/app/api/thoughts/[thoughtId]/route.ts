import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfThought, notFound } from "@/lib/authz";

type P = { thoughtId: string };

const patchSchema = z.object({ orbitAngle: z.number().finite().nullable() });

/** Move one of your captured thoughts along its time ring (its date - and so its ring - doesn't change). */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const { thoughtId } = await params;
  await requireWorkspaceRole(user, await workspaceOfThought(thoughtId), "contributor");
  const { orbitAngle } = patchSchema.parse(await readJson(req));
  const t = await prisma.capturedThought.findUnique({ where: { id: thoughtId } });
  if (!t || t.userId !== user.id || t.status !== "captured") throw notFound("Thought");
  const angle = orbitAngle === null ? null : ((orbitAngle % 360) + 360) % 360;
  await prisma.capturedThought.update({ where: { id: thoughtId }, data: { orbitAngle: angle } });
  return NextResponse.json({ id: thoughtId, orbitAngle: angle });
});

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
