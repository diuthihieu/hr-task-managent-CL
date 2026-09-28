import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser, requireWorkspaceRole, route, readJson, workspaceOfDashboard, workspaceOfProject, visibleProjectWhere, badRequest, HttpError } from "@/lib/authz";
import { aiConfigured, generate, parseJsonAnswer } from "@/lib/ai/gemini";
import { buildFields, loadProjectMeta } from "@/lib/task-grid";
import { makeT, normalizeLocale } from "@/lib/i18n/core";
import { rateLimit } from "@/lib/rate-limit";
import { serializeWidget } from "@/lib/dashboard-serialize";
import { uuid } from "@/lib/validation";

export const maxDuration = 120;

const DASH_TYPES = ["kpi", "table", "bar", "column", "stacked_column", "stacked_bar", "line", "area", "pie", "donut", "funnel", "gauge"] as const;
const REPORT_TYPES = ["kpi", "bar", "column", "stacked_column", "stacked_bar", "line", "area", "pie", "donut", "pivot"] as const;
const AGGS = ["count", "sum", "avg", "min", "max"] as const;
const NUMERIC = new Set(["number", "integer", "percent", "currency", "progress", "rating", "duration"]);
const DATE = new Set(["date", "datetime", "created_time", "modified_time"]);

const schema = z.object({
  target: z.enum(["dashboard", "report"]),
  /** dashboard target: the dashboard to add widgets to. */
  dashboardId: uuid.optional(),
  /** report target: the project whose report view gets the widgets. */
  projectId: uuid.optional(),
  prompt: z.string().trim().min(3).max(2000),
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
  if (!rateLimit(`ai-build:${user.id}`, 10, 10 * 60_000)) throw new HttpError(429, "Too many AI requests - please wait a few minutes");
  const t = makeT(normalizeLocale(user.locale));

  let projectIds: string[];
  if (body.target === "dashboard") {
    if (!body.dashboardId) throw badRequest("dashboardId is required");
    const ctx = await requireWorkspaceRole(user, await workspaceOfDashboard(body.dashboardId), "editor");
    projectIds = (await prisma.project.findMany({ where: { workspaceId: ctx.workspaceId, deletedAt: null, ...visibleProjectWhere(user) }, orderBy: { sortOrder: "asc" }, take: 12, select: { id: true } })).map((p) => p.id);
  } else {
    if (!body.projectId) throw badRequest("projectId is required");
    await requireWorkspaceRole(user, await workspaceOfProject(body.projectId), "editor");
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

  const system = `You design charts for a task/OKR management app. Turn the user's request into 1-6 charts.
Answer ONLY with JSON: {"widgets":[{"title":"...","type":"<chart type>","projectId":"<project id>","dimensionFieldId":"<field id>","dimension2FieldId":"<optional field id>","measureFieldId":"<optional numeric field id>","aggregation":"count|sum|avg|min|max","dateBucket":"day|week|month (only when the dimension is a date)","sortDesc":true,"topN":10}]}
Rules:
- Chart types allowed: ${types.join(", ")}. "kpi" needs no dimension. ${body.target === "report" ? '"pivot" needs dimensionFieldId and dimension2FieldId.' : ""} Stacked charts need dimension2FieldId.
- Use ONLY project ids and field ids from the catalog. Measures must be "number" fields; count needs no measure.
- Titles are short, in the user's language.
CATALOG:
${JSON.stringify(catalog)}`;
  const r = await generate({ system, contents: [{ role: "user", parts: [{ text: body.prompt }] }], temperature: 0.1, json: true, maxOutputTokens: 4096 });
  const specs = (parseJsonAnswer<{ widgets?: Spec[] }>(r.text)?.widgets ?? []).slice(0, 6);

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
      };
    })
    .filter((w): w is NonNullable<typeof w> => !!w);
  if (!valid.length) throw new HttpError(502, "The AI couldn't map this request to charts - try naming the fields (e.g. 'tasks by status and assignee')");

  if (body.target === "report") {
    return NextResponse.json({ widgets: valid.map((w) => ({ id: nanoid(8), ...w, projectId: undefined })) });
  }
  const dashboardId = body.dashboardId!;
  const existing = await prisma.dashboardWidget.findMany({ where: { dashboardId }, select: { y: true, h: true } });
  let y = existing.reduce((m, b) => Math.max(m, b.y + b.h), 0);
  let x = 0;
  const created = [];
  for (const [i, w] of valid.entries()) {
    const width = w.type === "kpi" ? 3 : 6;
    const height = w.type === "kpi" ? 2 : 4;
    if (x + width > 12) {
      x = 0;
      y += 4;
    }
    const { projectId, title, type, ...cfg } = w;
    created.push(
      await prisma.dashboardWidget.create({
        data: { dashboardId, type, title, config: { dataSource: { projectId }, ...cfg } as Prisma.InputJsonValue, x, y, w: width, h: height, sortOrder: existing.length + i },
      })
    );
    x += width;
  }
  return NextResponse.json({ widgets: created.map(serializeWidget) }, { status: 201 });
});
