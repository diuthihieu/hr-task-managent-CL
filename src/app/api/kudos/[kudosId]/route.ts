import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { route, notFound, forbidden, roleAtLeast } from "@/lib/authz";
import { recoContext } from "@/lib/recognition/route-helpers";
import { KUDOS_INCLUDE, serializeKudos } from "@/lib/recognition/kudos";
import { isProjectHiddenFrom } from "@/lib/authz";

type P = { kudosId: string };

async function load(kudosId: string) {
  const k = await prisma.kudos.findFirst({ where: { id: kudosId, deletedAt: null }, include: KUDOS_INCLUDE });
  if (!k) throw notFound("Kudos");
  return k;
}

/** Open a letter. Private letters: sender and receiver only. Opening it as the receiver marks it read. */
export const GET = route<P>(async (_req, { params }) => {
  const { kudosId } = await params;
  const k = await load(kudosId);
  const { user, base } = await recoContext(k.workspaceId, { sync: false });
  const party = k.toId === user.id || k.fromId === user.id;
  if (!party && (!k.isPublic || (k.projectId && (await isProjectHiddenFrom(user, k.projectId))))) throw notFound("Kudos");
  if (k.toId === user.id && !k.readAt) {
    await prisma.kudos.update({ where: { id: k.id }, data: { readAt: new Date() } });
    await prisma.notification.updateMany({ where: { userId: user.id, type: "kudos", link: { endsWith: `/recognition/kudos/${k.id}` }, readAt: null }, data: { readAt: new Date() } });
  }
  return NextResponse.json(serializeKudos(k, base, user.id));
});

/** The sender or a workspace admin can withdraw a letter. */
export const DELETE = route<P>(async (_req, { params }) => {
  const { kudosId } = await params;
  const k = await load(kudosId);
  const { user, ctx } = await recoContext(k.workspaceId, { sync: false });
  if (k.fromId !== user.id && !roleAtLeast(ctx.role, "admin")) throw forbidden("Only the sender or an admin can remove this letter");
  await prisma.kudos.update({ where: { id: k.id }, data: { deletedAt: new Date() } });
  return new NextResponse(null, { status: 204 });
});
