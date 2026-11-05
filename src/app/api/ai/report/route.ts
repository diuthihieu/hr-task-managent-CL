import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfDashboard, workspaceOfProject, visibleProjectWhere, HttpError } from "@/lib/authz";
import { hoursByCategorySection } from "@/lib/ai/context";
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
  let projectIds: string[];
  if (body.targetKind === "project") {
    workspaceId = (await requireWorkspaceRole(user, await workspaceOfProject(body.targetId), "viewer")).workspaceId;
    source = `Dashboard view of project: ${(await prisma.project.findUniqueOrThrow({ where: { id: body.targetId }, select: { name: true } })).name}`;
    projectIds = [body.targetId];
  } else {
    workspaceId = (await requireWorkspaceRole(user, await workspaceOfDashboard(body.targetId), "viewer")).workspaceId;
    const dash = await prisma.dashboard.findUniqueOrThrow({ where: { id: body.targetId }, select: { name: true, widgets: { select: { config: true } } } });
    source = `Dashboard: ${dash.name}`;
    // Every project a widget reads (main, appended, merged); the hours query below keeps only those the user may see.
    projectIds = [
      ...new Set(
        dash.widgets.flatMap((w) => {
          const ds = (w.config as { dataSource?: { projectId?: unknown; appendProjectIds?: unknown; merge?: { projectId?: unknown } } } | null)?.dataSource;
          return [ds?.projectId, ...(Array.isArray(ds?.appendProjectIds) ? ds.appendProjectIds : []), ds?.merge?.projectId].filter((id): id is string => typeof id === "string");
        }),
      ),
    ];
  }
  // Hours facts straight from the tasks the user may see, so an hours report never depends on how a
  // chart happens to be configured (a chart with no value field shows 0).
  const facts = projectIds.length
    ? await hoursByCategorySection({ workspaceId, deletedAt: null, projectId: { in: projectIds }, project: { deletedAt: null, ...visibleProjectWhere(user) } })
    : "";
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
- Numbers must come from DATA. Tables are welcome. For hours (estimate / actual per person, category or month) use the "Hours per person, category and month" table in DATA, computed from the tasks; it covers every task of the projects before filters, so when the request or a chart is limited by filters (status, dates, a view...), use that chart's numbers for that scope or say which scope you report. A chart marked "(error: ...)" is misconfigured - don't report its value as 0.
- Totals: quote the "Pre-computed totals" tables in DATA. Never add up rows yourself; a table's total row must equal its pre-computed total, so build per-category tables from the per-category rows and give the pre-computed totals for the same person and month.
- Two bases, never mixed: BASIS A counts each task once (team totals); BASIS B counts a shared task in full for each assignee (per person). A share or rank of a person uses BASIS B for both numerator and denominator (the "share of the month's person-hours" column); say once which basis a team figure uses. The sum of people's hours is larger than the team total because of shared tasks - explain it with the "Why the two bases differ" table, never as an error.
- "done tasks" is not a completion rate when only done tasks are in scope. Give a completion rate only as done tasks / all tasks of the period and name both counts.
- A chart over dates puts a task's whole hours on its completion date: a peak means many tasks were closed that day, not that many hours were worked that day. Don't call it a workload spike unless the data shows the work itself.
- Estimate exactly equal to actual on every task of a group is a data pattern (actual copied from estimate, or estimate filled in afterwards), not proof of accurate estimating - say so if you mention it.
- Facts vs judgement: state as fact only what DATA shows (numbers, task titles, categories, dates). Causes, impact ("removes legal risk", "ensures quality") and system issues are inferences: mark them as such or leave them out. Targets in recommendations (e.g. "-50% time") are proposals: label them "proposed target" and give the baseline from DATA when there is one.
- Hours: at most 2 decimals.
- If the user names the file, use that name for fileName.
CHARTS:
${chartList}`,
    data: `${source}\n\n${body.data}${facts ? `\n\n${facts}` : ""}`,
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
