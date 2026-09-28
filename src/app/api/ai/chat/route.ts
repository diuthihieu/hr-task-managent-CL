import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, notFound, badRequest, HttpError } from "@/lib/authz";
import { aiConfigured, streamGenerate, type GeminiContent, type Usage } from "@/lib/ai/gemini";
import { projectKnowledge, workspaceData } from "@/lib/ai/context";
import { wikiSystemPrompt, assistantSystemPrompt } from "@/lib/ai/prompts";
import { uuid } from "@/lib/validation";

export const maxDuration = 120;

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 60;
const HISTORY = 20;

const schema = z.object({
  kind: z.enum(["wiki", "assistant"]),
  workspaceId: uuid.optional(),
  projectId: uuid.optional(),
  conversationId: uuid.optional(),
  message: z.string().trim().min(1).max(8000),
});

/**
 * Ask the wiki assistant (kind=wiki, projectId) or the workspace AI assistant
 * (kind=assistant, workspaceId). Streams the answer as plain text; the
 * conversation id comes back in the X-Conversation-Id header. Both turns are
 * saved, so history lives in the database rather than the browser.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  if (!aiConfigured()) throw new HttpError(503, "AI is not configured on this server (GEMINI_API_KEY missing)");

  let workspaceId: string;
  let projectId: string | null = null;
  let system: string;
  if (body.kind === "wiki") {
    if (!body.projectId) throw badRequest("projectId is required");
    const ctx = await requireWorkspaceRole(user, await workspaceOfProject(body.projectId), "viewer");
    workspaceId = ctx.workspaceId;
    projectId = body.projectId;
    const [project, settings, knowledge] = await Promise.all([
      prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { name: true, workspace: { select: { name: true } } } }),
      prisma.projectAiSettings.findUnique({ where: { projectId } }),
      projectKnowledge(projectId),
    ]);
    if (settings && !settings.enabled) throw new HttpError(403, "The project owner has turned the wiki assistant off");
    system = wikiSystemPrompt({ project: project.name, workspace: project.workspace.name, instructions: settings?.instructions ?? "", knowledge: knowledge.text });
  } else {
    if (!body.workspaceId) throw badRequest("workspaceId is required");
    const ctx = await requireWorkspaceRole(user, body.workspaceId, "viewer");
    workspaceId = ctx.workspaceId;
    const [ws, data] = await Promise.all([prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } }), workspaceData(user, workspaceId)]);
    system = assistantSystemPrompt({ workspace: ws.name, user: user.name, role: ctx.role, now: new Date(), data: data.text });
  }

  // Per-user daily quota keeps API costs predictable.
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const used = await prisma.aiMessage.count({ where: { role: "user", createdAt: { gte: since }, conversation: { userId: user.id } } });
  if (used >= DAILY_LIMIT) throw new HttpError(429, `Daily AI limit reached (${DAILY_LIMIT} questions per 24 hours)`);

  let conversationId = body.conversationId;
  if (conversationId) {
    const c = await prisma.aiConversation.findFirst({ where: { id: conversationId, userId: user.id, workspaceId, kind: body.kind, projectId } });
    if (!c) throw notFound("Conversation");
  } else {
    const c = await prisma.aiConversation.create({ data: { workspaceId, projectId, userId: user.id, kind: body.kind, title: body.message.replace(/\s+/g, " ").slice(0, 120) } });
    conversationId = c.id;
  }
  const history = await prisma.aiMessage.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: HISTORY, select: { role: true, content: true } });
  await prisma.aiMessage.create({ data: { conversationId, role: "user", content: body.message } });
  const contents: GeminiContent[] = [...history.reverse().map((m) => ({ role: m.role, parts: [{ text: m.content }] })), { role: "user", parts: [{ text: body.message }] }];

  const usage: Usage = { tokensIn: null, tokensOut: null };
  const chunks = await streamGenerate({ system, contents, temperature: body.kind === "wiki" ? 0.3 : 0.2 }, usage, req.signal);
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
