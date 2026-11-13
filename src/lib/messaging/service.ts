// Messages: contacts among people who share a workspace, 1-1 and group chats, the Woli AI inbox.
// Every rule is enforced here (the routes only parse input):
// - a contact request or a group member needs at least one live workspace in common;
// - a 1-1 chat needs an accepted contact, and nobody can write to someone who blocked them (or whom they blocked);
// - a member reads only messages sent while they were in the conversation;
// - a tagged task shows its title only to readers who may see it now; others get "a task you can't see";
// - authors may edit or recall their message for one hour.
import "server-only";
import { Prisma, type ConversationKind } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { badRequest, forbidden, notFound, HttpError, type SessionUser } from "@/lib/authz";
import { rateLimit } from "@/lib/rate-limit";
import { pushDirect, sendDirectPush } from "@/lib/push";
import { publish } from "./realtime";
import { splitMessage } from "./split-message";
import { plainInline } from "@/lib/agent-work/markdown-blocks";
import { makeT, normalizeLocale } from "@/lib/i18n/core";

export const MESSAGE_MAX = 4000;
/** One Woli AI message. A longer report continues in the next message; nothing is cut. */
export const BOT_MESSAGE_MAX = 30_000;
export const EDIT_WINDOW_MS = 60 * 60_000;
export const GROUP_MAX_MEMBERS = 100;
const PAGE = 50;

const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
const pairKey = (a: string, b: string) => pair(a, b).join(":");

/** A live workspace both people belong to. */
export async function shareWorkspace(a: string, b: string): Promise<boolean> {
  if (a === b) return true;
  const row = await prisma.workspaceMember.findFirst({ where: { userId: b, workspace: { deletedAt: null, members: { some: { userId: a } } } }, select: { userId: true } });
  return !!row;
}

const activeUser = { isActive: true, deletedAt: null } satisfies Prisma.UserWhereInput;
const PERSON = { id: true, name: true, email: true, avatarColor: true } satisfies Prisma.UserSelect;

// ---------------------------------------------------------------------------------------------------
// Contacts

async function contactOf(a: string, b: string) {
  const [userAId, userBId] = pair(a, b);
  return prisma.contact.findUnique({ where: { userAId_userBId: { userAId, userBId } } });
}

/** Is either side blocking the other? */
export async function blockedBetween(a: string, b: string): Promise<boolean> {
  return (await contactOf(a, b))?.status === "blocked";
}

/** People I share a workspace with, matching the search, with where we stand. */
export async function searchPeople(user: SessionUser, q: string) {
  const term = q.trim().slice(0, 80);
  const people = await prisma.user.findMany({
    where: {
      ...activeUser,
      id: { not: user.id },
      memberships: { some: { workspace: { deletedAt: null, members: { some: { userId: user.id } } } } },
      ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { email: { contains: term, mode: "insensitive" } }] } : {}),
    },
    select: PERSON,
    orderBy: { name: "asc" },
    take: 20,
  });
  const contacts = await prisma.contact.findMany({ where: { OR: people.map((p) => { const [userAId, userBId] = pair(user.id, p.id); return { userAId, userBId }; }) } });
  const byOther = new Map(contacts.map((c) => [c.userAId === user.id ? c.userBId : c.userAId, c]));
  return people.map((p) => {
    const c = byOther.get(p.id);
    // A block by the other person reads as "none" (they can't be found to have blocked you); a request
    // to them then fails with the same neutral message.
    const status = !c ? "none" : c.status === "blocked" ? (c.requestedById === user.id ? "blocked" : "none") : c.status === "pending" ? (c.requestedById === user.id ? "outgoing" : "incoming") : "friend";
    return { ...p, status };
  });
}

export async function listContacts(user: SessionUser) {
  const rows = await prisma.contact.findMany({
    where: { OR: [{ userAId: user.id }, { userBId: user.id }], NOT: { status: "blocked", requestedById: { not: user.id } } },
    include: { userA: { select: { ...PERSON, isActive: true, deletedAt: true } }, userB: { select: { ...PERSON, isActive: true, deletedAt: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const out = { friends: [] as Person[], incoming: [] as Person[], outgoing: [] as Person[], blocked: [] as Person[] };
  for (const r of rows) {
    const other = r.userAId === user.id ? r.userB : r.userA;
    if (!other.isActive || other.deletedAt) continue;
    const p: Person = { id: other.id, name: other.name, email: other.email, avatarColor: other.avatarColor };
    if (r.status === "accepted") out.friends.push(p);
    else if (r.status === "blocked") out.blocked.push(p);
    else (r.requestedById === user.id ? out.outgoing : out.incoming).push(p);
  }
  out.friends.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
export interface Person {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
}

const CANT_REQUEST = "You can't send a request to this person";

/** Sends a request, or accepts theirs when they already asked me. */
export async function requestContact(user: SessionUser, targetId: string) {
  if (targetId === user.id) throw badRequest(CANT_REQUEST);
  const target = await prisma.user.findFirst({ where: { id: targetId, ...activeUser }, select: { id: true } });
  if (!target || !(await shareWorkspace(user.id, targetId))) throw notFound("Person");
  if (!(await rateLimit(`contact-request:${user.id}`, 40, 24 * 3600_000))) throw new HttpError(429, "Too many requests today - try again tomorrow");
  const [userAId, userBId] = pair(user.id, targetId);
  const existing = await contactOf(user.id, targetId);
  if (existing?.status === "blocked") throw badRequest(CANT_REQUEST);
  if (existing?.status === "accepted") return { status: "friend" as const };
  if (existing?.status === "pending" && existing.requestedById !== user.id) {
    await prisma.contact.update({ where: { id: existing.id }, data: { status: "accepted" } });
    publish([targetId, user.id], "contact", { u: user.id });
    return { status: "friend" as const };
  }
  if (!existing) {
    await prisma.contact.create({ data: { userAId, userBId, status: "pending", requestedById: user.id } }).catch((e: unknown) => {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e; // a request crossing mine
    });
    publish([targetId], "contact", { u: user.id });
    const recipient = await prisma.user.findFirst({ where: { id: targetId, deletedAt: null }, select: { locale: true } });
    pushDirect(prisma, [targetId], { title: user.name, body: makeT(normalizeLocale(recipient?.locale))("chat.pushRequest"), url: "/messages?tab=contacts", tag: `contact:${user.id}` });
  }
  return { status: "outgoing" as const };
}

export async function respondContact(user: SessionUser, otherId: string, action: "accept" | "decline" | "remove" | "block" | "unblock") {
  const c = await contactOf(user.id, otherId);
  if (action === "block") {
    if (otherId === user.id) throw badRequest("You can't block yourself");
    const [userAId, userBId] = pair(user.id, otherId);
    if (c?.status === "blocked" && c.requestedById !== user.id) return { status: "blocked" }; // they blocked first; keep theirs
    await prisma.contact.upsert({ where: { userAId_userBId: { userAId, userBId } }, create: { userAId, userBId, status: "blocked", requestedById: user.id }, update: { status: "blocked", requestedById: user.id } });
    publish([otherId], "contact", { u: user.id });
    return { status: "blocked" };
  }
  if (!c) throw notFound("Contact");
  if (action === "unblock") {
    if (c.status !== "blocked" || c.requestedById !== user.id) throw notFound("Contact");
    await prisma.contact.delete({ where: { id: c.id } });
    return { status: "none" };
  }
  if (c.status === "blocked") throw notFound("Contact");
  if (action === "accept") {
    if (c.status !== "pending" || c.requestedById === user.id) throw badRequest("There is no request from this person");
    await prisma.contact.update({ where: { id: c.id }, data: { status: "accepted" } });
    publish([otherId], "contact", { u: user.id });
    return { status: "friend" };
  }
  // decline (theirs), cancel (mine) or remove a friend: the row goes, a new request is possible later.
  if (action === "decline" && c.status !== "pending") throw badRequest("There is no request to decline");
  await prisma.contact.delete({ where: { id: c.id } });
  publish([otherId], "contact", { u: user.id });
  return { status: "none" };
}

// ---------------------------------------------------------------------------------------------------
// Conversations

const activeMember = (userId: string) => ({ userId, leftAt: null });
/**
 * Messages written by someone else, Woli AI included. Not `NOT: { authorId }`: in SQL that drops rows
 * whose author is NULL, so messages from Woli AI were never counted as unread.
 */
const notMine = (userId: string): Prisma.ChatMessageWhereInput => ({ OR: [{ authorId: null }, { authorId: { not: userId } }] });

/** My membership, or 404 (never reveal that a conversation exists). */
async function membership(user: SessionUser, conversationId: string) {
  const m = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId: user.id } },
    include: { conversation: { include: { members: { where: { leftAt: null }, select: { userId: true, muted: true, isAdmin: true } } } } },
  });
  if (!m) throw notFound("Conversation");
  return m;
}

/** The Woli AI inbox of a user (created on first use). Only its owner is a member. */
export async function botInbox(userId: string) {
  const key = `bot:${userId}`;
  const found = await prisma.conversation.findUnique({ where: { pairKey: key }, select: { id: true } });
  if (found) return found.id;
  try {
    const c = await prisma.conversation.create({ data: { kind: "bot", pairKey: key, botOwnerId: userId, members: { create: { userId } } }, select: { id: true } });
    return c.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return (await prisma.conversation.findUniqueOrThrow({ where: { pairKey: key }, select: { id: true } })).id;
    throw e;
  }
}

/** The 1-1 conversation with a friend (created on first use). */
export async function openDirect(user: SessionUser, otherId: string) {
  const c = await contactOf(user.id, otherId);
  if (!c || c.status !== "accepted") throw forbidden("Add this person as a contact first");
  const key = pairKey(user.id, otherId);
  const found = await prisma.conversation.findUnique({ where: { pairKey: key }, select: { id: true } });
  if (found) {
    // Back in after hiding it? Direct chats are never left, so nothing to restore.
    return found.id;
  }
  try {
    const created = await prisma.conversation.create({ data: { kind: "direct", pairKey: key, createdById: user.id, members: { create: [{ userId: user.id }, { userId: otherId }] } }, select: { id: true } });
    return created.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return (await prisma.conversation.findUniqueOrThrow({ where: { pairKey: key }, select: { id: true } })).id;
    throw e;
  }
}

/** Members I may add to a group: active people sharing a workspace with me, not blocking either way. */
async function assertAddable(user: SessionUser, ids: string[]) {
  for (const id of ids) {
    if (id === user.id) continue;
    const ok = (await prisma.user.count({ where: { id, ...activeUser } })) > 0 && (await shareWorkspace(user.id, id)) && !(await blockedBetween(user.id, id));
    if (!ok) throw badRequest("Some people can't be added: they must share a workspace with you");
  }
}

export async function createGroup(user: SessionUser, name: string, memberIds: string[]) {
  const ids = [...new Set(memberIds.filter((id) => id !== user.id))];
  if (!ids.length) throw badRequest("Add at least one person");
  if (ids.length + 1 > GROUP_MAX_MEMBERS) throw badRequest(`A group has at most ${GROUP_MAX_MEMBERS} people`);
  if (!(await rateLimit(`chat-group:${user.id}`, 20, 24 * 3600_000))) throw new HttpError(429, "Too many new groups today");
  await assertAddable(user, ids);
  const c = await prisma.conversation.create({
    data: { kind: "group", name: name.trim().slice(0, 120), createdById: user.id, members: { create: [{ userId: user.id, isAdmin: true }, ...ids.map((userId) => ({ userId }))] } },
    select: { id: true },
  });
  publish(ids, "conversation", { c: c.id });
  return c.id;
}

export async function updateGroup(user: SessionUser, conversationId: string, input: { name?: string; add?: string[]; remove?: string[]; leave?: boolean; muted?: boolean }) {
  const m = await membership(user, conversationId);
  if (m.leftAt) throw notFound("Conversation");
  const conv = m.conversation;
  if (input.muted !== undefined) await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: user.id } }, data: { muted: input.muted } });
  const changesGroup = input.name !== undefined || input.add?.length || input.remove?.length || input.leave;
  if (!changesGroup) return;
  if (conv.kind !== "group") throw badRequest("Only a group can be changed");
  const others = conv.members.map((x) => x.userId);
  if (input.leave) {
    await prisma.$transaction(async (tx) => {
      await tx.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: user.id } }, data: { leftAt: new Date(), isAdmin: false } });
      // The last admin leaving hands the group to the longest-standing member.
      if (m.isAdmin && !conv.members.some((x) => x.isAdmin && x.userId !== user.id)) {
        const next = await tx.conversationMember.findFirst({ where: { conversationId, leftAt: null }, orderBy: { joinedAt: "asc" } });
        if (next) await tx.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: next.userId } }, data: { isAdmin: true } });
      }
    });
    publish(others, "conversation", { c: conversationId });
    return;
  }
  if (!m.isAdmin) throw forbidden("Only a group admin can change the group");
  const add = [...new Set(input.add ?? [])].filter((id) => !others.includes(id));
  if (add.length) {
    if (others.length + add.length > GROUP_MAX_MEMBERS) throw badRequest(`A group has at most ${GROUP_MAX_MEMBERS} people`);
    await assertAddable(user, add);
  }
  const remove = [...new Set(input.remove ?? [])].filter((id) => id !== user.id && others.includes(id));
  const now = new Date();
  await prisma.$transaction([
    ...(input.name !== undefined ? [prisma.conversation.update({ where: { id: conversationId }, data: { name: input.name.trim().slice(0, 120) || null } })] : []),
    // Re-adding someone who left starts their history again from now.
    ...add.map((userId) => prisma.conversationMember.upsert({ where: { conversationId_userId: { conversationId, userId } }, create: { conversationId, userId }, update: { leftAt: null, joinedAt: now, lastReadAt: now, isAdmin: false } })),
    ...(remove.length ? [prisma.conversationMember.updateMany({ where: { conversationId, userId: { in: remove } }, data: { leftAt: now, isAdmin: false } })] : []),
  ]);
  publish([...others, ...add], "conversation", { c: conversationId });
}

/** My conversations (newest first) with the last message I may see and my unread count. */
export async function listConversations(user: SessionUser) {
  await botInbox(user.id);
  const rows = await prisma.conversationMember.findMany({
    where: activeMember(user.id),
    include: {
      conversation: {
        include: {
          members: { where: { leftAt: null }, include: { user: { select: { ...PERSON, isActive: true, deletedAt: true } } } },
          messages: { orderBy: { createdAt: "desc" }, take: 1, include: { author: { select: { name: true } } } },
        },
      },
    },
    orderBy: { conversation: { lastMessageAt: "desc" } },
    take: 200,
  });
  const unread = await prisma.chatMessage.groupBy({
    by: ["conversationId"],
    where: { AND: [{ OR: rows.map((r) => ({ conversationId: r.conversationId, createdAt: { gt: r.lastReadAt } })) }, notMine(user.id)] },
    _count: { _all: true },
  });
  const unreadBy = new Map(unread.map((u) => [u.conversationId, u._count._all]));
  return rows.map((r) => {
    const c = r.conversation;
    const others = c.members.filter((x) => x.userId !== user.id).map((x) => ({ id: x.user.id, name: x.user.name, avatarColor: x.user.avatarColor, email: x.user.email, gone: !x.user.isActive || !!x.user.deletedAt }));
    const last = c.messages[0] && c.messages[0].createdAt >= r.joinedAt ? c.messages[0] : null;
    return {
      id: c.id,
      kind: c.kind as ConversationKind,
      name: c.kind === "group" ? c.name : c.kind === "bot" ? null : (others[0]?.name ?? null),
      members: others,
      isAdmin: r.isAdmin,
      muted: r.muted,
      lastMessageAt: c.lastMessageAt,
      unread: unreadBy.get(c.id) ?? 0,
      last: last ? { body: last.recalledAt ? null : last.body.slice(0, 140), recalled: !!last.recalledAt, author: last.authorId === user.id ? null : (last.author?.name ?? (c.kind === "bot" ? "Woli AI" : null)), at: last.createdAt } : null,
    };
  });
}

/** Contact requests waiting for my answer (counted in the sidebar badge and on the Contacts tab). */
export async function pendingRequests(user: SessionUser): Promise<number> {
  return (await listContacts(user)).incoming.length;
}

/** Total unread messages (the sidebar badge). */
export async function unreadTotal(user: SessionUser): Promise<number> {
  const rows = await prisma.conversationMember.findMany({ where: { ...activeMember(user.id), muted: false }, select: { conversationId: true, lastReadAt: true } });
  if (!rows.length) return 0;
  return prisma.chatMessage.count({ where: { AND: [{ OR: rows.map((r) => ({ conversationId: r.conversationId, createdAt: { gt: r.lastReadAt } })) }, notMine(user.id)] } });
}

// ---------------------------------------------------------------------------------------------------
// Messages

/** Tagged tasks as this reader may see them right now. */
async function resolveTasks(user: SessionUser, ids: string[]) {
  if (!ids.length) return new Map<string, TaskRef>();
  const tasks = await prisma.task.findMany({
    where: { id: { in: ids }, deletedAt: null, project: { deletedAt: null, hiddenMembers: { none: { userId: user.id } } }, workspace: { deletedAt: null, members: { some: { userId: user.id } } } },
    select: { id: true, title: true, projectId: true, project: { select: { name: true } }, workspace: { select: { slug: true } }, status: { select: { name: true, category: true } } },
  });
  return new Map(tasks.map((t) => [t.id, { id: t.id, title: t.title, project: t.project.name, projectId: t.projectId, workspaceSlug: t.workspace.slug, status: t.status.name, done: t.status.category === "done" } as TaskRef]));
}
export interface TaskRef {
  id: string;
  title: string;
  project: string;
  projectId: string;
  workspaceSlug: string;
  status: string;
  done: boolean;
}

/**
 * A page of messages (oldest first), only from the time I was a member. `ids` instead re-reads given
 * messages (an edit or recall of one older than the latest page), under the same window.
 */
export async function listMessages(user: SessionUser, conversationId: string, before?: Date, ids?: string[]) {
  const m = await membership(user, conversationId);
  const window: Prisma.DateTimeFilter = { gte: m.joinedAt, ...(m.leftAt ? { lte: m.leftAt } : {}), ...(before ? { lt: before } : {}) };
  const rows = await prisma.chatMessage.findMany({
    where: { conversationId, createdAt: window, ...(ids ? { id: { in: ids.slice(0, PAGE) } } : {}) },
    orderBy: { createdAt: "desc" },
    take: PAGE + 1,
    include: { author: { select: { id: true, name: true, avatarColor: true } } },
  });
  const more = rows.length > PAGE;
  const page = rows.slice(0, PAGE).reverse();
  const tasks = await resolveTasks(user, [...new Set(page.flatMap((r) => r.taskIds))]);
  const outputIds = [...new Set(page.flatMap((r) => r.outputIds))];
  const outputs = outputIds.length && m.conversation.kind === "bot" ? await prisma.agentOutput.findMany({ where: { id: { in: outputIds }, deletedAt: null, run: { userId: user.id } }, select: { id: true, filename: true, type: true } }) : [];
  const outputBy = new Map(outputs.map((o) => [o.id, o]));
  const readers = m.conversation.kind === "direct" ? await prisma.conversationMember.findFirst({ where: { conversationId, userId: { not: user.id } }, select: { lastReadAt: true } }) : null;
  return {
    more,
    otherReadAt: readers?.lastReadAt ?? null,
    messages: page.map((r) => ({
      id: r.id,
      author: r.author ? { id: r.author.id, name: r.author.name, avatarColor: r.author.avatarColor } : null,
      mine: r.authorId === user.id,
      body: r.recalledAt ? "" : r.body,
      recalled: !!r.recalledAt,
      edited: !!r.editedAt,
      createdAt: r.createdAt,
      tasks: r.recalledAt ? [] : r.taskIds.map((id) => tasks.get(id) ?? { id, hidden: true as const }),
      outputs: r.outputIds.map((id) => outputBy.get(id)).filter((o): o is NonNullable<typeof o> => !!o),
    })),
  };
}

/** Task ids the sender may tag: tasks they can see. */
async function taggable(user: SessionUser, ids: string[]) {
  const unique = [...new Set(ids)].slice(0, 10);
  const visible = await resolveTasks(user, unique);
  if (visible.size !== unique.length) throw badRequest("Some tagged tasks are not visible to you");
  return unique;
}

export async function sendMessage(user: SessionUser, conversationId: string, input: { body: string; taskIds?: string[] }) {
  const body = input.body.trim();
  if (!body) throw badRequest("Write a message");
  if (body.length > MESSAGE_MAX) throw badRequest(`A message has at most ${MESSAGE_MAX} characters`);
  const m = await membership(user, conversationId);
  if (m.leftAt) throw forbidden("You are no longer in this conversation");
  const conv = m.conversation;
  if (conv.kind === "bot") throw badRequest("Woli AI only sends messages here");
  const others = conv.members.filter((x) => x.userId !== user.id);
  if (conv.kind === "direct") {
    const other = others[0]?.userId ?? (await prisma.conversationMember.findFirst({ where: { conversationId, userId: { not: user.id } }, select: { userId: true } }))?.userId;
    const c = other ? await contactOf(user.id, other) : null;
    if (!c || c.status !== "accepted") throw forbidden("You can only message your contacts");
  }
  if (!(await rateLimit(`chat-send:${user.id}`, 60, 60_000))) throw new HttpError(429, "You are sending too fast - wait a moment");
  const taskIds = input.taskIds?.length ? await taggable(user, input.taskIds) : [];
  const now = new Date();
  const msg = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({ data: { conversationId, authorId: user.id, body, taskIds, createdAt: now } });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: now } });
    await tx.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: user.id } }, data: { lastReadAt: now } });
    return created;
  });
  publish(conv.members.map((x) => x.userId), "message", { c: conversationId, m: msg.id });
  const notify = others.filter((x) => !x.muted).map((x) => x.userId);
  pushDirect(prisma, notify, { title: conv.kind === "group" ? `${user.name} · ${conv.name ?? "Group"}` : user.name, body: body.slice(0, 140), url: `/messages?c=${conversationId}`, tag: `chat:${conversationId}` });
  return { id: msg.id, createdAt: msg.createdAt };
}

async function ownRecentMessage(user: SessionUser, messageId: string) {
  const msg = await prisma.chatMessage.findUnique({ where: { id: messageId }, include: { conversation: { include: { members: { where: { leftAt: null }, select: { userId: true } } } } } });
  if (!msg || !msg.conversation.members.some((x) => x.userId === user.id)) throw notFound("Message");
  if (msg.authorId !== user.id) throw forbidden("You can only change your own messages");
  if (msg.recalledAt) throw badRequest("This message was recalled");
  if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_MS) throw badRequest("Messages can be changed for one hour after sending");
  return msg;
}

export async function editMessage(user: SessionUser, messageId: string, input: { body: string; taskIds?: string[] }) {
  const msg = await ownRecentMessage(user, messageId);
  const body = input.body.trim();
  if (!body) throw badRequest("Write a message");
  if (body.length > MESSAGE_MAX) throw badRequest(`A message has at most ${MESSAGE_MAX} characters`);
  const taskIds = input.taskIds ? await taggable(user, input.taskIds) : msg.taskIds;
  await prisma.chatMessage.update({ where: { id: messageId }, data: { body, taskIds, editedAt: new Date() } });
  publish(msg.conversation.members.map((x) => x.userId), "message", { c: msg.conversationId, m: messageId });
}

/** Recall within the hour: the text and tags are wiped for everyone; "message recalled" stays. */
export async function recallMessage(user: SessionUser, messageId: string) {
  const msg = await ownRecentMessage(user, messageId);
  await prisma.chatMessage.update({ where: { id: messageId }, data: { body: "", taskIds: [], recalledAt: new Date() } });
  publish(msg.conversation.members.map((x) => x.userId), "message", { c: msg.conversationId, m: messageId });
}

export async function markRead(user: SessionUser, conversationId: string) {
  const m = await membership(user, conversationId);
  if (m.leftAt) return;
  // Only when something from others was unread: reading a read receipt must not send one back.
  const unseen = await prisma.chatMessage.count({ where: { conversationId, createdAt: { gt: m.lastReadAt }, OR: [{ authorId: null }, { authorId: { not: user.id } }] } });
  if (!unseen) return;
  await prisma.conversationMember.update({ where: { conversationId_userId: { conversationId, userId: user.id } }, data: { lastReadAt: new Date() } });
  if (m.conversation.kind === "direct") publish(m.conversation.members.map((x) => x.userId).filter((id) => id !== user.id), "read", { c: conversationId });
}

export async function typing(user: SessionUser, conversationId: string) {
  if (!(await rateLimit(`chat-typing:${user.id}`, 30, 60_000))) return;
  const m = await membership(user, conversationId);
  if (m.leftAt || m.conversation.kind === "bot") return;
  publish(m.conversation.members.map((x) => x.userId).filter((id) => id !== user.id), "typing", { c: conversationId, u: user.id, n: user.name });
}

/** Tasks I can see that match, for the "#" picker. */
export async function searchTasks(user: SessionUser, q: string) {
  const term = q.trim().slice(0, 80);
  const tasks = await prisma.task.findMany({
    where: {
      deletedAt: null,
      project: { deletedAt: null, hiddenMembers: { none: { userId: user.id } } },
      workspace: { deletedAt: null, members: { some: { userId: user.id } } },
      ...(term ? { title: { contains: term, mode: "insensitive" } } : {}),
    },
    select: { id: true, title: true, project: { select: { name: true } }, workspace: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
    take: 15,
  });
  return tasks.map((t) => ({ id: t.id, title: t.title, project: t.project.name, workspace: t.workspace.name }));
}

/**
 * Woli AI writes into a user's inbox (scheduled workflows, background Skill runs). The whole text is
 * delivered: beyond BOT_MESSAGE_MAX it continues in further messages, divided between blocks (a table
 * keeps its header). Attached files come with the last message. Returns the first message's id.
 */
export async function postBotMessage(userId: string, body: string, opts: { outputIds?: string[]; taskIds?: string[] } = {}) {
  const conversationId = await botInbox(userId);
  const parts = splitMessage(body, BOT_MESSAGE_MAX);
  const start = Date.now();
  const ids = await prisma.$transaction(async (tx) => {
    const created: string[] = [];
    for (const [i, part] of parts.entries()) {
      const last = i === parts.length - 1;
      // One millisecond apart, so the parts keep their order.
      const row = await tx.chatMessage.create({ data: { conversationId, authorId: null, body: part, outputIds: last ? (opts.outputIds ?? []) : [], taskIds: last ? (opts.taskIds ?? []) : [], createdAt: new Date(start + i) } });
      created.push(row.id);
    }
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date(start + parts.length - 1) } });
    return created;
  });
  const msg = { id: ids[0] };
  publish([userId], "message", { c: conversationId, m: ids[ids.length - 1] ?? null });
  // Awaited: this runs in background jobs (the workflow tick), where work queued for "after the response"
  // was dropped once the job finished. A failed push never fails the message.
  await sendDirectPush(prisma, [userId], { title: "Woli AI", body: plainInline(body).replace(/\s+/g, " ").slice(0, 140), url: `/messages?c=${conversationId}`, tag: `chat:${conversationId}` }).catch((e) => console.error("[push] bot message", e));
  return msg.id;
}
