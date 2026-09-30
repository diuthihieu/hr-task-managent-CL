import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfProject, badRequest, HttpError } from "@/lib/authz";
import { aiConfigured, generate, parseJsonAnswer, type GeminiContent } from "@/lib/ai/gemini";
import { draftSchema, intakeScope, sanitizeDraft, intakeSystemPrompt, projectData, localNow } from "@/lib/ai/task-intake";
import { personalPromptBlock } from "@/lib/ai/personal";
import { rateLimit } from "@/lib/rate-limit";
import { uuid } from "@/lib/validation";

export const maxDuration = 120;

const DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 60;

const schema = z.object({
  /** Workspace Intelligence: the workspace. Project chat: projectId (the workspace follows from it). */
  workspaceId: uuid.optional(),
  projectId: uuid.optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "model"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(30)
    .refine((m) => m[m.length - 1].role === "user", "The last message must be the user's"),
  draft: draftSchema.nullish(),
  timeZone: z.string().max(64).optional(),
});

/**
 * One turn of the AI task intake / project chat. The conversation lives in the
 * browser (it is short-lived and nothing is created until the user confirms);
 * the answer is JSON: {type: question|summary|answer, message, draft}.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  if (!aiConfigured()) throw new HttpError(503, "AI is not configured on this server (GEMINI_API_KEY missing)");
  if (!body.workspaceId && !body.projectId) throw badRequest("workspaceId or projectId is required");

  // Project chat: the project must be visible to the caller (404 otherwise).
  const ctx = body.projectId ? await requireWorkspaceRole(user, await workspaceOfProject(body.projectId), "viewer") : await requireWorkspaceRole(user, body.workspaceId, "viewer");
  if (body.workspaceId && body.workspaceId !== ctx.workspaceId) throw badRequest("The project is not in this workspace");
  if (!(await rateLimit(`ai-intake:${user.id}`, 40, 10 * 60_000))) throw new HttpError(429, "Too many AI messages - please wait a few minutes");
  if (!(await rateLimit(`ai-intake-day:${user.id}`, DAILY_LIMIT * 2, 24 * 3600_000))) throw new HttpError(429, `Daily AI limit reached (${DAILY_LIMIT * 2} messages per 24 hours)`);

  const workspaceId = ctx.workspaceId;
  const scope = await intakeScope(user, workspaceId, ctx.role, body.projectId ?? null);
  const current = body.draft ? sanitizeDraft(body.draft, scope) : null;
  const [ws, data, personal] = await Promise.all([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } }),
    body.projectId ? projectData(user, body.projectId) : Promise.resolve(null),
    personalPromptBlock(user.id),
  ]);
  const now = localNow(body.timeZone);
  const locale = user.locale === "en" ? "en" : "vi";
  const system = intakeSystemPrompt({ workspace: ws.name, user: { id: user.id, name: user.name }, scope, now: now.text, locale, draft: current, projectData: data, personal });
  const contents: GeminiContent[] = body.messages.map((m) => ({ role: m.role, parts: [{ text: m.content }] }));

  const r = await generate({ workspaceId, system, contents, temperature: 0.2, json: true, maxOutputTokens: 2048 });
  const parsed = parseJsonAnswer<{ type?: unknown; message?: unknown; draft?: unknown }>(r.text);
  const type = parsed?.type === "question" || parsed?.type === "summary" || parsed?.type === "answer" ? parsed.type : "answer";
  const message = typeof parsed?.message === "string" && parsed.message.trim() ? parsed.message.trim().slice(0, 8000) : parsed ? "…" : r.text.trim().slice(0, 8000) || "…";
  const rawDraft = draftSchema.safeParse(parsed?.draft);
  // Viewers never get a draft, whatever the model says; answers keep the draft in progress.
  const draft = !scope.canCreate ? null : rawDraft.success && parsed?.draft ? sanitizeDraft(rawDraft.data, scope) : current;
  return NextResponse.json({ type: type === "summary" && !draft ? "answer" : type, message, draft, canCreate: scope.canCreate, today: now.date });
});
