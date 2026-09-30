import "server-only";
import type { Prisma } from "@prisma/client";

export const KUDOS_INCLUDE = {
  from: { select: { id: true, name: true, avatarColor: true, avatarUpdatedAt: true } },
  to: { select: { id: true, name: true, avatarColor: true, avatarUpdatedAt: true } },
  task: { select: { id: true, title: true, projectId: true, deletedAt: true } },
  project: { select: { id: true, name: true, deletedAt: true } },
  reactions: { orderBy: { createdAt: "asc" }, select: { emoji: true, userId: true, user: { select: { name: true } } } },
} satisfies Prisma.KudosInclude;

/** Reactions people can leave on a letter. */
export const KUDOS_REACTIONS = ["❤️", "😍", "😢", "😂", "🙏", "👏", "🎉", "🔥"] as const;

type Row = Prisma.KudosGetPayload<{ include: typeof KUDOS_INCLUDE }>;

const person = (u: Row["from"]) => ({ id: u.id, name: u.name, avatarColor: u.avatarColor, hasAvatar: !!u.avatarUpdatedAt });

export function serializeKudos(k: Row, base: string, viewerId: string) {
  return {
    id: k.id,
    style: k.style,
    template: k.template,
    greeting: k.greeting,
    closing: k.closing,
    title: k.title,
    message: k.message,
    reason: k.reason,
    values: k.values,
    isPublic: k.isPublic,
    from: person(k.from),
    to: person(k.to),
    task: k.task && !k.task.deletedAt ? { id: k.task.id, title: k.task.title, href: `${base}/p/${k.task.projectId}/t/${k.task.id}` } : null,
    project: k.project && !k.project.deletedAt ? { id: k.project.id, name: k.project.name, href: `${base}/p/${k.project.id}` } : null,
    read: !!k.readAt,
    mine: k.toId === viewerId,
    sentByMe: k.fromId === viewerId,
    href: `${base}/recognition/kudos/${k.id}`,
    reactions: KUDOS_REACTIONS.map((emoji) => {
      const rs = k.reactions.filter((r) => r.emoji === emoji);
      return { emoji, count: rs.length, mine: rs.some((r) => r.userId === viewerId), names: rs.map((r) => r.user.name) };
    }).filter((r) => r.count > 0),
    createdAt: k.createdAt.toISOString(),
  };
}
export type KudosDto = ReturnType<typeof serializeKudos>;
