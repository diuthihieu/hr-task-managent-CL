import { NextResponse } from "next/server";
import type { AgentOriginType } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfTask, workspaceOfObjective, workspaceOfWikiPage, workspaceOfDashboard, workspaceOfProject, badRequest, HttpError } from "@/lib/authz";
import { aiConfigured, generate, streamGenerate, parseJsonAnswer, type Usage } from "@/lib/ai/gemini";
import { ACTION_INSTRUCTIONS, STRUCTURED_ACTIONS, actionSystemPrompt, taskContext, objectiveContext, wikiPageContext, myDayContext, type AiActionName } from "@/lib/ai/actions";
import { rateLimit } from "@/lib/rate-limit";
import { personalPromptBlock } from "@/lib/ai/personal";
import { uuid } from "@/lib/validation";

export const maxDuration = 120;

const schema = z.object({
  action: z.enum(Object.keys(ACTION_INSTRUCTIONS) as [AiActionName, ...AiActionName[]]),
  targetId: uuid,
  /** Dashboard actions: the chart data the viewer is looking at. */
  data: z.string().max(60000).optional(),
  /** Dashboard actions: targetId is a dashboard (default) or a project (its report view). */
  targetKind: z.enum(["dashboard", "project"]).optional(),
  /** Optional extra instruction from the user ("make it shorter"...). */
  note: z.string().max(2000).optional(),
});

const AREA: Record<string, string> = { task: "task page", okr: "OKR page", wiki: "wiki", dash: "dashboard", home: "Home (daily command center)" };

/**
 * Run an embedded AI action on a task, objective, wiki page, dashboard or on
 * Home (targetId = workspace id). Text actions stream Markdown; structured
 * actions (task_breakdown, wiki_extract_tasks) answer JSON {items:[...]}.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  if (!aiConfigured()) throw new HttpError(503, "AI is not configured on this server (GEMINI_API_KEY missing)");
  if (!(await rateLimit(`ai-action:${user.id}`, 30, 10 * 60_000))) throw new HttpError(429, "Too many AI actions - please wait a few minutes");

  const kind = body.action.split("_")[0];
  let workspaceId: string;
  let data: string;
  let originType: AgentOriginType = "workspace";
  let projectId: string | null = null;
  let taskId: string | null = null;
  let wikiId: string | null = null;
  if (kind === "task") {
    const ctx = await requireWorkspaceRole(user, await workspaceOfTask(body.targetId), "viewer");
    workspaceId = ctx.workspaceId;
    projectId = ctx.projectId ?? null;
    taskId = body.targetId;
    originType = "task";
    data = await taskContext(body.targetId);
  } else if (kind === "okr") {
    const ctx = await requireWorkspaceRole(user, await workspaceOfObjective(body.targetId), "viewer");
    workspaceId = ctx.workspaceId;
    projectId = ctx.projectId ?? null;
    data = await objectiveContext(user, body.targetId, workspaceId, body.action === "okr_unlinked");
  } else if (kind === "wiki") {
    const ctx = await requireWorkspaceRole(user, await workspaceOfWikiPage(body.targetId), "viewer");
    workspaceId = ctx.workspaceId;
    wikiId = ctx.wikiId ?? null;
    originType = "wiki";
    data = await wikiPageContext(body.targetId);
  } else if (kind === "dash") {
    originType = "dashboard";
    if (!body.data) throw badRequest("Send the dashboard's chart data");
    if (body.targetKind === "project") {
      workspaceId = (await requireWorkspaceRole(user, await workspaceOfProject(body.targetId), "viewer")).workspaceId;
      projectId = body.targetId;
      const p = await prisma.project.findUniqueOrThrow({ where: { id: body.targetId }, select: { name: true } });
      data = `Report view of project: ${p.name}\n\n${body.data}`;
    } else {
      workspaceId = (await requireWorkspaceRole(user, await workspaceOfDashboard(body.targetId), "viewer")).workspaceId;
      const d = await prisma.dashboard.findUniqueOrThrow({ where: { id: body.targetId }, select: { name: true } });
      data = `Dashboard: ${d.name}\n\n${body.data}`;
    }
  } else {
    workspaceId = (await requireWorkspaceRole(user, body.targetId, "viewer")).workspaceId;
    data = await myDayContext(user, workspaceId);
  }
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { name: true } });
  const system = actionSystemPrompt({
    area: AREA[kind] ?? "app",
    workspace: ws.name,
    user: user.name,
    locale: user.locale ?? "vi",
    instructions: ACTION_INSTRUCTIONS[body.action] + (body.note ? `\nExtra request from the user: ${body.note}` : ""),
    data,
    personal: await personalPromptBlock(user.id),
  });
  const contents = [{ role: "user" as const, parts: [{ text: body.note || "Go." }] }];
  const conversationData = {
    workspaceId,
    userId: user.id,
    kind: "assistant" as const,
    title: `${body.action.replaceAll("_", " ")}${body.note ? `: ${body.note}` : ""}`.slice(0, 200),
    originType,
    originId: body.targetId,
    projectId,
    taskId,
    wikiId,
  };

  if (STRUCTURED_ACTIONS.has(body.action)) {
    const r = await generate({ workspaceId, system, contents, temperature: 0.2, json: true, maxOutputTokens: 4096 });
    const parsed = parseJsonAnswer<{ items?: { title?: unknown; estimateHours?: unknown; note?: unknown }[] }>(r.text);
    const items = (parsed?.items ?? [])
      .filter((i) => typeof i.title === "string" && i.title.trim())
      .slice(0, 20)
      .map((i) => ({ title: String(i.title).trim().slice(0, 300), estimateHours: typeof i.estimateHours === "number" && i.estimateHours > 0 ? Math.min(i.estimateHours, 200) : null, note: typeof i.note === "string" ? i.note.slice(0, 500) : "" }));
    if (!items.length) throw new HttpError(502, "The AI didn't return usable suggestions - please try again");
    const conversation = await prisma.aiConversation.create({ data: { ...conversationData, messages: { create: [{ role: "user", content: body.note || body.action }, { role: "model", content: JSON.stringify({ items }), tokensIn: r.tokensIn, tokensOut: r.tokensOut }] } } });
    return NextResponse.json({ items, conversationId: conversation.id });
  }

  const usage: Usage = { tokensIn: null, tokensOut: null };
  const chunks = await streamGenerate({ workspaceId, system, contents, temperature: 0.3 }, usage, req.signal);
  const conversation = await prisma.aiConversation.create({ data: { ...conversationData, messages: { create: { role: "user", content: body.note || body.action } } } });
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        let answer = "";
        try {
          for await (const text of chunks) {
            answer += text;
            controller.enqueue(encoder.encode(text));
          }
        } catch (e) {
          console.error("[ai-action] stream failed", e);
          const note = "\n\n_(The answer was interrupted. Please try again.)_";
          answer += note;
          controller.enqueue(encoder.encode(note));
        } finally {
          await prisma.aiMessage.create({ data: { conversationId: conversation.id, role: "model", content: answer || "_(no answer)_", tokensIn: usage.tokensIn, tokensOut: usage.tokensOut } }).catch((error) => console.error("[ai-action] history save failed", error));
          controller.close();
        }
      },
    }),
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Conversation-Id": conversation.id } }
  );
});
