import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfDashboard, workspaceOfProject, visibleProjectWhere, badRequest, HttpError } from "@/lib/authz";
import { aiConfigured, generate, parseJsonAnswer, ROUTE_120_BUDGET } from "@/lib/ai/gemini";
import { buildFields, loadProjectMeta } from "@/lib/task-grid";
import { makeT, normalizeLocale } from "@/lib/i18n/core";
import { rateLimit } from "@/lib/rate-limit";
import { serializeWidget } from "@/lib/dashboard-serialize";
import { uuid } from "@/lib/validation";
import { BUILD_PROMPT_MAX } from "@/lib/ai/limits";
import { logActivity } from "@/lib/activity";

export const maxDuration = 120;

const DASH_TYPES = ["kpi", "table", "bar", "column", "stacked_column", "stacked_bar", "line", "area", "pie", "donut", "funnel", "gauge", "narrative"] as const;
const REPORT_TYPES = ["kpi", "bar", "column", "stacked_column", "stacked_bar", "line", "area", "pie", "donut", "pivot", "narrative"] as const;
const AGGS = ["count", "sum", "avg", "min", "max"] as const;
const NUMERIC = new Set(["number", "integer", "percent", "currency", "progress", "rating", "duration"]);
const DATE = new Set(["date", "datetime", "created_time", "modified_time"]);

const MAX_WIDGETS = { dashboard: 16, report: 12 } as const;
/** Grid columns a width hint takes (12-column grid). */
const WIDTHS: Record<string, number> = { full: 12, two_thirds: 8, half: 6, third: 4, quarter: 3 };

const schema = z.object({
  target: z.enum(["dashboard", "report"]),
  /** dashboard target: the dashboard to add widgets to. */
  dashboardId: uuid.optional(),
  /** report target: the project whose report view gets the widgets. */
  projectId: uuid.optional(),
  prompt: z.string().trim().min(3).max(BUILD_PROMPT_MAX),
  /** dashboard target: add to it, replace its widgets, or put them on a new dashboard. */
  mode: z.enum(["append", "replace", "new"]).default("append"),
});

interface Spec {
  title?: string;
  type?: string;
  projectId?: string;
  dimensionFieldId?: string;
  dimension2FieldId?: string;
  measureFieldId?: string;
  aggregation?: string;
  dateBucket?: string;
  sortDesc?: boolean;
  topN?: number;
  width?: string;
  prompt?: string;
}

/**
 * "Build with AI": turn a request ("overdue work by person, tasks per status
 * per month") into charts. The model only picks chart types and field ids
 * from the lists we give it; everything is validated before it's saved, and
 * the charts compute from live data like any hand-made chart.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  if (!aiConfigured()) throw new HttpError(503, "AI is not configured on this server (GEMINI_API_KEY missing)");
  if (!(await rateLimit(`ai-build:${user.id}`, 10, 10 * 60_000))) throw new HttpError(429, "Too many AI requests - please wait a few minutes");
  const t = makeT(normalizeLocale(user.locale));

  let projectIds: string[];
  let workspaceId: string;
  if (body.target === "dashboard") {
    if (!body.dashboardId) throw badRequest("dashboardId is required");
    const ctx = await requireWorkspaceRole(user, await workspaceOfDashboard(body.dashboardId), "editor");
    workspaceId = ctx.workspaceId;
    projectIds = (await prisma.project.findMany({ where: { workspaceId: ctx.workspaceId, deletedAt: null, ...visibleProjectWhere(user) }, orderBy: { sortOrder: "asc" }, take: 12, select: { id: true } })).map((p) => p.id);
  } else {
    if (!body.projectId) throw badRequest("projectId is required");
    workspaceId = (await requireWorkspaceRole(user, await workspaceOfProject(body.projectId), "editor")).workspaceId;
    projectIds = [body.projectId];
  }
  const catalog: { id: string; name: string; fields: { id: string; name: string; type: string; kind: string }[] }[] = [];
  for (const id of projectIds) {
    const meta = await loadProjectMeta(id);
    if (!meta) continue;
    const fields = buildFields(meta, t).filter((f) => !["sys_title", "sys_description", "sys_attachments"].includes(f.id));
    catalog.push({ id, name: meta.project.name, fields: fields.map((f) => ({ id: f.id, name: f.name, type: f.type, kind: NUMERIC.has(f.type) ? "number" : DATE.has(f.type) ? "date" : "category" })) });
  }
  if (!catalog.length) throw badRequest("No project to build charts from");
  const types = body.target === "dashboard" ? DASH_TYPES : REPORT_TYPES;

  const max = MAX_WIDGETS[body.target];
  const system = `You design ${body.target === "dashboard" ? "dashboards" : "report views"} for a task/OKR management app. The request can be a single chart, a few charts, or a whole dashboard layout (KPI row, main sections, columns, bottom section...). Build everything it asks for that the data supports: 1-${max} widgets, in reading order (top-left to bottom-right).
Answer ONLY with JSON: {"name":"<short dashboard name in the user's language>","widgets":[{"title":"...","type":"<chart type>","projectId":"<project id>","dimensionFieldId":"<field id>","dimension2FieldId":"<optional field id>","measureFieldId":"<optional numeric field id>","aggregation":"count|sum|avg|min|max","dateBucket":"day|week|month (only when the dimension is a date)","sortDesc":true,"topN":10,"width":"full|two_thirds|half|third|quarter"}]}
Rules:
- Layout: widgets fill a 12-column grid row by row. Use "width" to match the described layout (a KPI row of 4 cards = 4 x "quarter"; a 40%/60% split = "third" + "two_thirds"; a full-width trend = "full"). Default: kpi "quarter", other charts "half".
- When part of the request can't be built from the catalog (e.g. data that isn't a field), skip it or use the closest available chart; never invent ids.
- Chart types allowed: ${types.join(", ")}. "kpi" needs no dimension. "narrative" is an AI-written commentary card that re-reads the other widgets and updates itself with the data: add one when the request asks for analysis, commentary, insights or a summary text; it needs no fields, only an optional "prompt" (its focus, in the user's language). ${body.target === "report" ? '"pivot" needs dimensionFieldId and dimension2FieldId.' : ""} Stacked charts need dimension2FieldId.
- Use ONLY project ids and field ids from the catalog. Measures must be "number" fields; count needs no measure.
- Titles are short, in the user's language.
CATALOG:
${JSON.stringify(catalog)}`;
  const r = await generate({ workspaceId, system, contents: [{ role: "user", parts: [{ text: body.prompt }] }], temperature: 0.1, json: true, maxOutputTokens: 8192, timeBudgetMs: ROUTE_120_BUDGET });
  const answer = parseJsonAnswer<{ name?: string; widgets?: Spec[] }>(r.text);
  const specs = (answer?.widgets ?? []).slice(0, max);

  // Validate every id against the catalog.
  const valid = specs
    .map((w) => {
      const project = catalog.find((p) => p.id === w.projectId) ?? catalog[0];
      const field = (id?: string) => (id ? project.fields.find((f) => f.id === id) : undefined);
      const type = (types as readonly string[]).includes(w.type ?? "") ? w.type! : "column";
      const dim = field(w.dimensionFieldId);
      const dim2 = field(w.dimension2FieldId);
      const measure = field(w.measureFieldId);
      const aggregation = (AGGS as readonly string[]).includes(w.aggregation ?? "") && (w.aggregation === "count" || measure?.kind === "number") ? w.aggregation! : "count";
      if (type === "narrative")
        return { title: String(w.title ?? "").slice(0, 120) || t("report.type.narrative"), type, projectId: project.id, dimensionFieldId: undefined, dimension2FieldId: undefined, measureFieldId: undefined, aggregation: "count" as const, dateBucket: undefined, sortDesc: true, topN: undefined, width: WIDTHS[w.width ?? ""] ?? 12, prompt: typeof w.prompt === "string" ? w.prompt.slice(0, 500) : undefined };
      if (type !== "kpi" && !dim) return null;
      if ((type === "pivot" || type.startsWith("stacked")) && !dim2) return null;
      return {
        title: String(w.title ?? "").slice(0, 120) || t("report.type." + type as never),
        type,
        projectId: project.id,
        dimensionFieldId: dim?.id,
        dimension2FieldId: dim2?.id,
        measureFieldId: aggregation === "count" ? undefined : measure?.id,
        aggregation: aggregation as "count" | "sum" | "avg" | "min" | "max",
        dateBucket: dim?.kind === "date" && ["day", "week", "month"].includes(w.dateBucket ?? "") ? (w.dateBucket as "day" | "week" | "month") : dim?.kind === "date" ? ("month" as const) : undefined,
        sortDesc: w.sortDesc !== false,
        topN: typeof w.topN === "number" && w.topN > 0 ? Math.min(Math.round(w.topN), 50) : undefined,
        width: WIDTHS[w.width ?? ""] ?? (type === "kpi" ? 3 : 6),
      };
    })
    .filter((w): w is NonNullable<typeof w> => !!w);
  if (!valid.length) throw new HttpError(502, "The AI couldn't map this request to charts - try naming the fields (e.g. 'tasks by status and assignee')");

  // Lay the widgets out row by row on the 12-column grid (y starts at 0; the
  // caller offsets it below existing widgets).
  let x = 0;
  let y = 0;
  let rowH = 0;
  const placed = valid.map(({ width, ...w }) => {
    // Row units differ: dashboards use ~80px rows, report views ~32px rows.
    const h = body.target === "dashboard" ? (w.type === "kpi" ? 2 : w.type === "table" ? 5 : 4) : w.type === "kpi" ? 5 : w.type === "pivot" ? 12 : 10;
    if (x + width > 12) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    const layout = { x, y, w: width, h };
    x += width;
    rowH = Math.max(rowH, h);
    return { ...w, layout };
  });

  if (body.target === "report") {
    return NextResponse.json({ widgets: placed.map((w) => ({ id: nanoid(8), ...w, wide: w.layout.w === 12, projectId: undefined })) });
  }
  const created = await prisma.$transaction(async (tx) => {
    let dashboardId = body.dashboardId!;
    if (body.mode === "new") {
      const name = String(answer?.name ?? "").trim().slice(0, 120) || t("aiBuild.newName");
      const dash = await tx.dashboard.create({ data: { workspaceId, name, createdById: user.id, updatedById: user.id } });
      await logActivity(tx, { workspaceId, actorId: user.id, entityType: "dashboard", entityId: dash.id, action: "created", summary: `Created dashboard "${name}" with AI` });
      dashboardId = dash.id;
    } else if (body.mode === "replace") {
      await tx.dashboardWidget.deleteMany({ where: { dashboardId } });
    }
    const existing = await tx.dashboardWidget.findMany({ where: { dashboardId }, select: { y: true, h: true } });
    const top = existing.reduce((m, b) => Math.max(m, b.y + b.h), 0);
    const rows = [];
    for (const [i, w] of placed.entries()) {
      const { projectId, title, type, layout, ...cfg } = w;
      rows.push(
        await tx.dashboardWidget.create({
          data: { dashboardId, type, title, config: { dataSource: { projectId }, ...cfg } as Prisma.InputJsonValue, x: layout.x, y: top + layout.y, w: layout.w, h: layout.h, sortOrder: existing.length + i },
        })
      );
    }
    return { dashboardId, rows };
  });
  return NextResponse.json({ dashboardId: created.dashboardId, widgets: created.rows.map(serializeWidget) }, { status: 201 });
});
