import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, notFound } from "@/lib/authz";

type P = { conversationId: string };

async function own(userId: string, id: string) {
  const c = await prisma.aiConversation.findFirst({ where: { id, userId } });
  if (!c) throw notFound("Conversation");
  return c;
}

export const GET = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { conversationId } = await params;
  const c = await own(user.id, conversationId);
  // Still a member (and the project still visible)?
  await requireWorkspaceRole(user, { workspaceId: c.workspaceId, wikiId: c.wikiId }, "viewer");
  const messages = await prisma.aiMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "asc" }, select: { id: true, role: true, content: true, createdAt: true } });
  return NextResponse.json({ id: c.id, title: c.title, kind: c.kind, messages: messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })) });
});

export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { conversationId } = await params;
  await own(user.id, conversationId);
  await prisma.aiConversation.delete({ where: { id: conversationId } });
  return new NextResponse(null, { status: 204 });
});
