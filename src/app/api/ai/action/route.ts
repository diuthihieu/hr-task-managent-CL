import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfTask, workspaceOfObjective, workspaceOfWikiPage, workspaceOfDashboard, badRequest, HttpError } from "@/lib/authz";
import { aiConfigured, generate, streamGenerate, parseJsonAnswer, type Usage } from "@/lib/ai/gemini";
import { ACTION_INSTRUCTIONS, STRUCTURED_ACTIONS, actionSystemPrompt, taskContext, objectiveContext, wikiPageContext, myDayContext, type AiActionName } from "@/lib/ai/actions";
import { rateLimit } from "@/lib/rate-limit";
import { uuid } from "@/lib/validation";

export const maxDuration = 120;

const schema = z.object({
  action: z.enum(Object.keys(ACTION_INSTRUCTIONS) as [AiActionName, ...AiActionName[]]),
  targetId: uuid,
  /** Dashboard actions: the chart data the viewer is looking at. */
  data: z.string().max(60000).optional(),
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
  if (!rateLimit(`ai-action:${user.id}`, 30, 10 * 60_000)) throw new HttpError(429, "Too many AI actions - please wait a few minutes");

  const kind = body.action.split("_")[0];
  let workspaceId: string;
  let data: string;
  if (kind === "task") {
    workspaceId = (await requireWorkspaceRole(user, await workspaceOfTask(body.targetId), "viewer")).workspaceId;
    data = await taskContext(body.targetId);
  } else if (kind === "okr") {
    workspaceId = (await requireWorkspaceRole(user, await workspaceOfObjective(body.targetId), "viewer")).workspaceId;
    data = await objectiveContext(user, body.targetId, workspaceId, body.action === "okr_unlinked");
  } else if (kind === "wiki") {
    workspaceId = (await requireWorkspaceRole(user, await workspaceOfWikiPage(body.targetId), "viewer")).workspaceId;
    data = await wikiPageContext(body.targetId);
  } else if (kind === "dash") {
    workspaceId = (await requireWorkspaceRole(user, await workspaceOfDashboard(body.targetId), "viewer")).workspaceId;
    if (!body.data) throw badRequest("Send the dashboard's chart data");
    const d = await prisma.dashboard.findUniqueOrThrow({ where: { id: body.targetId }, select: { name: true } });
    data = `Dashboard: ${d.name}\n\n${body.data}`;
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
  });
  const contents = [{ role: "user" as const, parts: [{ text: body.note || "Go." }] }];

  if (STRUCTURED_ACTIONS.has(body.action)) {
    const r = await generate({ system, contents, temperature: 0.2, json: true, maxOutputTokens: 4096 });
    const parsed = parseJsonAnswer<{ items?: { title?: unknown; estimateHours?: unknown; note?: unknown }[] }>(r.text);
    const items = (parsed?.items ?? [])
      .filter((i) => typeof i.title === "string" && i.title.trim())
      .slice(0, 20)
      .map((i) => ({ title: String(i.title).trim().slice(0, 300), estimateHours: typeof i.estimateHours === "number" && i.estimateHours > 0 ? Math.min(i.estimateHours, 200) : null, note: typeof i.note === "string" ? i.note.slice(0, 500) : "" }));
    if (!items.length) throw new HttpError(502, "The AI didn't return usable suggestions - please try again");
    return NextResponse.json({ items });
  }

  const usage: Usage = { tokensIn: null, tokensOut: null };
  const chunks = await streamGenerate({ system, contents, temperature: 0.3 }, usage, req.signal);
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const text of chunks) controller.enqueue(encoder.encode(text));
        } catch (e) {
          console.error("[ai-action] stream failed", e);
          controller.enqueue(encoder.encode("\n\n_(The answer was interrupted. Please try again.)_"));
        } finally {
          controller.close();
        }
      },
    }),
    { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } }
  );
});
