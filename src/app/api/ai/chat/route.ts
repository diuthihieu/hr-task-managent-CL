import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, requireWiki, route, readJson, notFound, badRequest, HttpError, hiddenProjectIds } from "@/lib/authz";
import { aiConfigured, streamGenerate, type GeminiContent, type Usage } from "@/lib/ai/gemini";
import { wikiKnowledge, workspaceData } from "@/lib/ai/context";
import { wikiSystemPrompt, assistantSystemPrompt } from "@/lib/ai/prompts";
import { personalPromptBlock } from "@/lib/ai/personal";
import { uuid } from "@/lib/validation";

export const maxDuration = 120;

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 60;
const HISTORY = 20;

const schema = z.object({
  kind: z.enum(["wiki", "assistant"]),
  workspaceId: uuid.optional(),
  wikiId: uuid.optional(),
  conversationId: uuid.optional(),
  message: z.string().trim().min(1).max(8000),
});

/**
 * Ask a wiki's assistant (kind=wiki, wikiId) or the workspace AI assistant
 * (kind=assistant, workspaceId). Streams the answer as plain text; the
 * conversation id comes back in the X-Conversation-Id header. Both turns are
 * saved, so history lives in the database rather than the browser.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  if (!aiConfigured()) throw new HttpError(503, "AI is not configured on this server (GEMINI_API_KEY missing)");

  let workspaceId: string;
  let wikiId: string | null = null;
  let system: string;
  if (body.kind === "wiki") {
    if (!body.wikiId) throw badRequest("wikiId is required");
    const ctx = await requireWiki(user, body.wikiId, "viewer");
    workspaceId = ctx.workspaceId;
    wikiId = body.wikiId;
    const [wiki, settings, knowledge] = await Promise.all([
      prisma.wiki.findUniqueOrThrow({ where: { id: wikiId }, select: { name: true, workspace: { select: { name: true } } } }),
      prisma.wikiAiSettings.findUnique({ where: { wikiId } }),
      hiddenProjectIds(user).then((hidden) => wikiKnowledge(wikiId!, undefined, hidden)),
    ]);
    if (settings && !settings.enabled) throw new HttpError(403, "The wiki's managers have turned its assistant off");
    system = wikiSystemPrompt({ wiki: wiki.name, workspace: wiki.workspace.name, instructions: settings?.instructions ?? "", knowledge: knowledge.text, personal: await personalPromptBlock(user.id) });
  } else {
    if (!body.workspaceId) throw badRequest("workspaceId is required");
    const ctx = await requireWorkspaceRole(user, body.workspaceId, "viewer");
    workspaceId = ctx.workspaceId;
    const [ws, data] = await Promise.all([prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } }), workspaceData(user, workspaceId, ctx.role)]);
    system = assistantSystemPrompt({ workspace: ws.name, user: user.name, role: ctx.role, now: new Date(), data: data.text, personal: await personalPromptBlock(user.id) });
  }

  // Per-user daily quota keeps API costs predictable.
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const used = await prisma.aiMessage.count({ where: { role: "user", createdAt: { gte: since }, conversation: { userId: user.id } } });
  if (used >= DAILY_LIMIT) throw new HttpError(429, `Daily AI limit reached (${DAILY_LIMIT} questions per 24 hours)`);

  let conversationId = body.conversationId;
  let history: { role: "user" | "model"; content: string }[] = [];
  if (conversationId) {
    const c = await prisma.aiConversation.findFirst({ where: { id: conversationId, userId: user.id, workspaceId, kind: body.kind, wikiId } });
    if (!c) throw notFound("Conversation");
    history = (await prisma.aiMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: HISTORY, select: { role: true, content: true } })).reverse();
  }
  const contents: GeminiContent[] = [...history.map((m) => ({ role: m.role, parts: [{ text: m.content }] })), { role: "user", parts: [{ text: body.message }] }];

  // Ask the model first: if Gemini is unavailable nothing is saved, so a retry
  // doesn't leave empty chats or duplicate questions behind.
  const usage: Usage = { tokensIn: null, tokensOut: null };
  const chunks = await streamGenerate({ system, contents, temperature: body.kind === "wiki" ? 0.3 : 0.2 }, usage, req.signal);

  if (!conversationId) {
    const c = await prisma.aiConversation.create({ data: { workspaceId, wikiId, userId: user.id, kind: body.kind, title: body.message.replace(/\s+/g, " ").slice(0, 120) } });
    conversationId = c.id;
  }
  await prisma.aiMessage.create({ data: { conversationId, role: "user", content: body.message } });
  const encoder = new TextEncoder();
  const convId = conversationId;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = "";
      try {
        for await (const text of chunks) {
          answer += text;
          controller.enqueue(encoder.encode(text));
        }
      } catch (e) {
        console.error("[ai] stream failed", e);
        const note = "\n\n_(The answer was interrupted. Please try again.)_";
        answer += note;
        controller.enqueue(encoder.encode(note));
      } finally {
        await prisma.aiMessage
          .create({ data: { conversationId: convId, role: "model", content: answer || "_(no answer)_", tokensIn: usage.tokensIn, tokensOut: usage.tokensOut } })
          .catch((e) => console.error("[ai] save failed", e));
        await prisma.aiConversation.update({ where: { id: convId }, data: { updatedAt: new Date() } }).catch(() => {});
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Conversation-Id": convId, "X-Accel-Buffering": "no" },
  });
});
