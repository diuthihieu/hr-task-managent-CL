import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson, notFound, isProjectHiddenFrom } from "@/lib/authz";
import { recoContext } from "@/lib/recognition/route-helpers";
import { KUDOS_INCLUDE, KUDOS_REACTIONS, serializeKudos } from "@/lib/recognition/kudos";

type P = { kudosId: string };
const schema = z.object({ emoji: z.enum(KUDOS_REACTIONS) });

/**
 * Toggle a reaction (❤️ 😢 🎉 …) on a letter anyone who may open it can see.
 * The other party of the letter hears about a new reaction (once per emoji).
 */
export const POST = route<P>(async (req, { params }) => {
  const { kudosId } = await params;
  const k = await prisma.kudos.findFirst({ where: { id: kudosId, deletedAt: null }, select: { id: true, workspaceId: true, fromId: true, toId: true, isPublic: true, projectId: true, title: true } });
  if (!k) throw notFound("Kudos");
  const { user, base } = await recoContext(k.workspaceId, { sync: false });
  const party = k.toId === user.id || k.fromId === user.id;
  if (!party && (!k.isPublic || (k.projectId && (await isProjectHiddenFrom(user, k.projectId))))) throw notFound("Kudos");
  const { emoji } = schema.parse(await readJson(req));
  const key = { kudosId_userId_emoji: { kudosId, userId: user.id, emoji } };
  const existing = await prisma.kudosReaction.findUnique({ where: key });
  if (existing) await prisma.kudosReaction.delete({ where: key });
  else {
    await prisma.kudosReaction.create({ data: { kudosId, userId: user.id, emoji } });
    // Tell the people the letter is between (not the reactor): sender and receiver.
    const to = [k.fromId, k.toId].filter((id) => id !== user.id);
    await prisma.notification.createMany({
      data: to.map((userId) => ({ userId, workspaceId: k.workspaceId, actorId: user.id, type: "kudos_reaction", title: k.title, data: { emoji }, link: `${base}/recognition/kudos/${k.id}`, dedupeKey: `kudos-reaction:${k.id}:${user.id}:${emoji}` })),
      skipDuplicates: true,
    });
  }
  const full = await prisma.kudos.findUniqueOrThrow({ where: { id: kudosId }, include: KUDOS_INCLUDE });
  return NextResponse.json(serializeKudos(full, base, user.id).reactions);
});
