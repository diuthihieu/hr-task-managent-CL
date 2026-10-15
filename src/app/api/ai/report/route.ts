import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfDashboard, workspaceOfProject, HttpError } from "@/lib/authz";
import { aiConfigured, generate, parseJsonAnswer, ROUTE_120_BUDGET } from "@/lib/ai/gemini";
import { actionSystemPrompt } from "@/lib/ai/actions";
import { personalPromptBlock } from "@/lib/ai/personal";
import { rateLimit } from "@/lib/rate-limit";
import { uuid } from "@/lib/validation";
import { workspaceLogoUrl } from "@/lib/workspace-logo";
import { REPORT_CHARTS_MAX, REPORT_FILENAME_MAX, REPORT_PROMPT_MAX, cleanFileName } from "@/lib/ai/report-limits";

export const maxDuration = 120;

const schema = z.object({
  targetKind: z.enum(["project", "dashboard"]),
  targetId: uuid,
  prompt: z.string().trim().min(3).max(REPORT_PROMPT_MAX),
  fileName: z.string().trim().max(REPORT_FILENAME_MAX).optional(),
  /** The chart data the user is looking at (same snapshot as AI Insight). */
  data: z.string().min(1).max(60_000),
  /** Charts on screen the report may embed, by id. */
  charts: z.array(z.object({ id: z.string().min(1).max(64), title: z.string().max(200) })).max(REPORT_CHARTS_MAX).default([]),
});

/**
 * AI PDF report: the user says what they want (goal, which visuals, analysis
 * depth, file name) and the model writes the report in Markdown, placing
 * charts with [[chart:<id>]] markers that the client swaps for the live chart.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  if (!aiConfigured()) throw new HttpError(503, "AI is not configured on this server (GEMINI_API_KEY missing)");
  if (!(await rateLimit(`ai-report:${user.id}`, 10, 10 * 60_000))) throw new HttpError(429, "Too many AI requests - please wait a few minutes");

  let workspaceId: string;
  let source: string;
  if (body.targetKind === "project") {
    workspaceId = (await requireWorkspaceRole(user, await workspaceOfProject(body.targetId), "viewer")).workspaceId;
    source = `Dashboard view of project: ${(await prisma.project.findUniqueOrThrow({ where: { id: body.targetId }, select: { name: true } })).name}`;
  } else {
    workspaceId = (await requireWorkspaceRole(user, await workspaceOfDashboard(body.targetId), "viewer")).workspaceId;
    source = `Dashboard: ${(await prisma.dashboard.findUniqueOrThrow({ where: { id: body.targetId }, select: { name: true } })).name}`;
  }
  const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true, name: true, logoUpdatedAt: true } });
  const chartList = body.charts.length ? body.charts.map((c) => `- [[chart:${c.id}]] ${c.title || "(untitled chart)"}`).join("\n") : "(no charts)";
  const system = actionSystemPrompt({
    area: "dashboard",
    workspace: ws.name,
    user: user.name,
    locale: user.locale ?? "vi",
    instructions: `Write a report to export as PDF, following the user's request (its goal, audience, which visuals, how much analysis, tone).
Answer ONLY with JSON: {"title":"<report title>","fileName":"<short file name without extension>","markdown":"<the report>"}
- The markdown starts with a "# " title, then sections ("## "). Typical: executive summary, key figures, one section per relevant chart with analysis, risks, recommendations - but follow the request (e.g. only visuals, only goals).
- To show a chart, put its marker alone on its own line, exactly as listed in CHARTS (e.g. [[chart:abc123]]). Use only listed charts; include all of them when the user asks for "all charts".
- Numbers must come from DATA. Tables are welcome.
- If the user names the file, use that name for fileName.
CHARTS:
${chartList}`,
    data: `${source}\n\n${body.data}`,
    personal: await personalPromptBlock(user.id),
  });
  const r = await generate({ workspaceId, system, contents: [{ role: "user", parts: [{ text: body.prompt + (body.fileName ? `\nFile name: ${body.fileName}` : "") }] }], temperature: 0.3, json: true, maxOutputTokens: 8192, timeBudgetMs: ROUTE_120_BUDGET });
  const out = parseJsonAnswer<{ title?: unknown; fileName?: unknown; markdown?: unknown }>(r.text);
  const markdown = typeof out?.markdown === "string" ? out.markdown.trim() : "";
  if (!markdown) throw new HttpError(502, "The AI didn't return a report - please try again");
  const title = (typeof out?.title === "string" && out.title.trim()) || markdown.match(/^#\s+(.+)$/m)?.[1] || "Report";
  const fileName = cleanFileName(body.fileName || (typeof out?.fileName === "string" ? out.fileName : "") || title) || "report";
  return NextResponse.json({ title: title.slice(0, 200), fileName, markdown: markdown.slice(0, 60_000), header: { workspace: ws.name, logoUrl: workspaceLogoUrl(ws), author: user.name } });
});
