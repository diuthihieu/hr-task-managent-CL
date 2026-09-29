import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { route, readJson, badRequest, notFound, HttpError, requireWorkspaceRole, requireWiki, workspaceOfProject } from "@/lib/authz";
import { generate } from "@/lib/ai/gemini";
import { personalPromptBlock, SCOPE_GUARD } from "@/lib/ai/personal";
import { brainContext } from "@/lib/brain/route-helpers";
import { assertAi } from "@/lib/brain/ai";
import { brainAskPrompt, citedNumbers, gatherSources, type AskScope } from "@/lib/brain/ask";
import { uuid } from "@/lib/validation";

type P = { workspaceId: string };

export const maxDuration = 120;

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 60;

const schema = z.object({
  question: z.string().trim().min(1).max(4000),
  scope: z.object({
    type: z.enum(["everything", "project", "wiki", "sources", "mine"]),
    projectId: uuid.optional(),
    wikiId: uuid.optional(),
    sources: z.array(z.string().regex(/^(wiki|task|decision|objective|file):[0-9a-f-]{36}$/)).max(30).optional(),
  }),
  conversationId: uuid.optional(),
});

/** Past Ask My Brain conversations of the caller (latest first), with sources on each answer. */
export const GET = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user } = await brainContext(workspaceId);
  const id = new URL(req.url).searchParams.get("conversationId");
  if (id) {
    const c = await prisma.aiConversation.findFirst({ where: { id, userId: user.id, workspaceId, kind: "brain" }, include: { messages: { orderBy: { createdAt: "asc" } } } });
    if (!c) throw notFound("Conversation");
    return NextResponse.json({ id: c.id, title: c.title, messages: c.messages.map((m) => ({ role: m.role, content: m.content, sources: m.sources, createdAt: m.createdAt.toISOString() })) });
  }
  const list = await prisma.aiConversation.findMany({ where: { userId: user.id, workspaceId, kind: "brain" }, orderBy: { updatedAt: "desc" }, take: 30, select: { id: true, title: true, updatedAt: true } });
  return NextResponse.json(list.map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() })));
});

/**
 * Ask My Brain. Retrieves the most relevant sources within the chosen scope
 * (all filtered by the caller's access), asks the model to answer with [S#]
 * citations, and returns the answer with every source used - saved with the
 * message so the answer stays traceable later.
 */
export const POST = route<P>(async (req, { params }) => {
  const { workspaceId } = await params;
  const { user, access, base, workspaceName } = await brainContext(workspaceId);
  assertAi(user.id, "ask");
  const body = schema.parse(await readJson(req));
  const scope: AskScope = body.scope;
  let scopeLabel = "everything the user can see";
  if (scope.type === "project") {
    if (!scope.projectId) throw badRequest("Pick a project");
    const s = await workspaceOfProject(scope.projectId);
    if (!s || s.workspaceId !== workspaceId) throw notFound("Project");
    await requireWorkspaceRole(user, s, "viewer");
    scopeLabel = `project "${(await prisma.project.findUniqueOrThrow({ where: { id: scope.projectId }, select: { name: true } })).name}"`;
  } else if (scope.type === "wiki") {
    if (!scope.wikiId) throw badRequest("Pick a wiki");
    const w = await requireWiki(user, scope.wikiId, "viewer");
    if (w.workspaceId !== workspaceId) throw notFound("Wiki");
    scopeLabel = `wiki "${(await prisma.wiki.findUniqueOrThrow({ where: { id: scope.wikiId }, select: { name: true } })).name}"`;
  } else if (scope.type === "sources") {
    if (!scope.sources?.length) throw badRequest("Pick at least one source");
    scopeLabel = "only the sources the user selected";
  } else if (scope.type === "mine") scopeLabel = "only the user's own notes, pages and journal";

  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const used = await prisma.aiMessage.count({ where: { role: "user", createdAt: { gte: since }, conversation: { userId: user.id } } });
  if (used >= DAILY_LIMIT) throw new HttpError(429, `Daily AI limit reached (${DAILY_LIMIT} questions per 24 hours)`);

  let history: { role: "user" | "model"; content: string }[] = [];
  if (body.conversationId) {
    const c = await prisma.aiConversation.findFirst({ where: { id: body.conversationId, userId: user.id, workspaceId, kind: "brain" } });
    if (!c) throw notFound("Conversation");
    history = (await prisma.aiMessage.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: "desc" }, take: 8, select: { role: true, content: true } })).reverse();
  }

  const sources = await gatherSources(access, base, scope, [body.question, ...history.filter((h) => h.role === "user").map((h) => h.content)].join(" ").slice(0, 2000));
  const system = brainAskPrompt({ workspace: workspaceName, user: user.name, scopeLabel, sources, personal: await personalPromptBlock(user.id), guard: SCOPE_GUARD, now: new Date() });
  const r = await generate({ system, contents: [...history.map((m) => ({ role: m.role, parts: [{ text: m.content }] })), { role: "user", parts: [{ text: body.question }] }], temperature: 0.2 });
  const cited = citedNumbers(r.text);
  const out = sources.map((s) => ({ ...s, used: cited.has(s.n) }));
  const saved = out.map(({ n, type, id, title, href, status, historical, used: u }) => ({ n, type, id, title, href, status, historical, used: u }));

  const conversationId =
    body.conversationId ?? (await prisma.aiConversation.create({ data: { workspaceId, userId: user.id, kind: "brain", title: body.question.replace(/\s+/g, " ").slice(0, 120) } })).id;
  await prisma.aiMessage.create({ data: { conversationId, role: "user", content: body.question } });
  await prisma.aiMessage.create({ data: { conversationId, role: "model", content: r.text, sources: saved, tokensIn: r.tokensIn, tokensOut: r.tokensOut } });
  await prisma.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });
  return NextResponse.json({ answer: r.text, sources: out, conversationId, grounded: cited.size > 0 });
});
