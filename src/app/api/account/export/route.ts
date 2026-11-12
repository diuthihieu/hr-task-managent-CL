import { NextResponse } from "next/server";
import { z } from "zod";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { requireUser, route, readJson } from "@/lib/authz";
import { HttpError } from "@/lib/http-errors";
import { rateLimit } from "@/lib/rate-limit";
import { makeT, normalizeLocale, type MessageKey } from "@/lib/i18n/core";
import { loadMyExport, myExportOptions, MY_EXPORT_MAX_ROWS } from "@/lib/my-export";
import { EXPORT_COLUMNS, exportRows, exportSummary, toCsv, type ExportColumn } from "@/lib/my-export-format";

const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish();
const range = z.object({ from: day, to: day }).optional();
const schema = z.object({
  filters: z
    .object({
      workspaceIds: z.array(id).max(200).optional(),
      projectIds: z.array(id).max(1000).optional(),
      assigneeIds: z.array(id).max(500).optional(),
      reporterIds: z.array(id).max(500).optional(),
      statuses: z.array(z.string().max(100)).max(100).optional(),
      startDate: range,
      dueDate: range,
      completedAt: range,
    })
    .default({}),
  columns: z.array(z.enum(EXPORT_COLUMNS)).max(EXPORT_COLUMNS.length).default([]),
  format: z.enum(["xlsx", "csv"]).default("xlsx"),
  preview: z.boolean().default(false),
});

/** Options for the export dialog: my workspaces, their visible projects, members and status names. */
export const GET = route(async () => {
  const user = await requireUser();
  return NextResponse.json(await myExportOptions(user));
});

/**
 * Preview (count + hours) or download of my tasks across every workspace I belong to.
 * Only tasks I may see are read; each download is written to the activity log of the workspaces it covers.
 */
export const POST = route(async (req) => {
  const user = await requireUser();
  const body = schema.parse(await readJson(req));
  // Separate buckets: the dialog previews on every filter change, which must not use up the download allowance.
  if (!(await rateLimit(body.preview ? `my-export-preview:${user.id}` : `my-export:${user.id}`, body.preview ? 120 : 20, 10 * 60_000))) throw new HttpError(429, "Too many exports - please wait a few minutes");
  const { tasks, tooMany, count, workspaceIds } = await loadMyExport(user, body.filters);
  const summary = exportSummary(tasks);
  if (body.preview || tooMany) {
    return NextResponse.json({ count, tooMany, max: MY_EXPORT_MAX_ROWS, actualHours: summary.totalActualH, workspaces: workspaceIds.length }, { status: tooMany && !body.preview ? 400 : 200 });
  }
  const columns = (body.columns.length ? EXPORT_COLUMNS.filter((c) => body.columns.includes(c)) : []) as ExportColumn[];
  if (!columns.length) throw new HttpError(400, "Choose at least one column");
  const me = await prisma.user.findUnique({ where: { id: user.id, deletedAt: null }, select: { locale: true } });
  const t = makeT(normalizeLocale(me?.locale));
  const header = columns.map((c) => t(`mx.col.${c}` as MessageKey));
  const origin = new URL(req.url).origin;
  const rows = exportRows(tasks, columns, origin);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `woli-tasks-${stamp}`;

  if (workspaceIds.length) {
    await prisma.activityLog.createMany({
      data: workspaceIds.map((workspaceId) => ({ workspaceId, actorId: user.id, entityType: "workspace", entityId: workspaceId, action: "exported", summary: `Exported own task data (${tasks.length} task(s) across ${workspaceIds.length} workspace(s), ${body.format.toUpperCase()})` })),
    });
  }

  if (body.format === "csv") {
    return new Response(toCsv(header, rows), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.csv"`, "Cache-Control": "private, no-store", "X-Export-Count": String(tasks.length) },
    });
  }

  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows]);
  sheet["!cols"] = columns.map((c) => ({ wch: c === "title" || c === "link" ? 48 : c === "workspace" || c === "project" || c === "assignees" || c === "reportTo" || c === "parent" ? 26 : 14 }));
  sheet["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length, 1), c: columns.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, sheet, "Tasks");
  const f = body.filters;
  const filterText = [
    f.startDate?.from || f.startDate?.to ? `${t("mx.startDate")}: ${f.startDate?.from ?? "…"} – ${f.startDate?.to ?? "…"}` : "",
    f.dueDate?.from || f.dueDate?.to ? `${t("mx.dueDate")}: ${f.dueDate?.from ?? "…"} – ${f.dueDate?.to ?? "…"}` : "",
    f.completedAt?.from || f.completedAt?.to ? `${t("mx.completedAt")}: ${f.completedAt?.from ?? "…"} – ${f.completedAt?.to ?? "…"}` : "",
    f.workspaceIds?.length ? `${t("mx.workspaces")}: ${f.workspaceIds.length}` : "",
    f.projectIds?.length ? `${t("mx.projects")}: ${f.projectIds.length}` : "",
    f.assigneeIds?.length ? `${t("mx.assignees")}: ${f.assigneeIds.length}` : "",
    f.reporterIds?.length ? `${t("mx.reporters")}: ${f.reporterIds.length}` : "",
    f.statuses?.length ? `${t("mx.statuses")}: ${f.statuses.join(", ")}` : "",
  ].filter(Boolean);
  const sum = XLSX.utils.aoa_to_sheet([
    [t("mx.title")],
    [t("mx.sum.exportedAt"), new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"],
    [t("mx.sum.filters"), filterText.join(" · ") || t("mx.all")],
    [],
    [t("mx.sum.byProject")],
    [t("mx.col.workspace"), t("mx.col.project"), t("mx.sum.tasks"), t("mx.col.estimateH"), t("mx.col.ownActualH")],
    ...summary.projects.map((p) => [p.workspace, p.project, p.tasks, p.estimateH, p.actualH]),
    [t("mx.sum.total"), "", summary.totalTasks, Math.round(summary.projects.reduce((n, p) => n + p.estimateH, 0) * 100) / 100, summary.totalActualH],
    [],
    [t("mx.sum.byPerson")],
    [t("mx.sum.person"), t("mx.col.workspace"), t("mx.sum.tasks"), t("mx.col.ownActualH")],
    ...summary.people.map((p) => [p.person, p.workspace, p.tasks, p.actualH]),
    [],
    [t("mx.hoursNote")],
  ]);
  sum["!cols"] = [{ wch: 30 }, { wch: 30 }, { wch: 10 }, { wch: 14 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, sum, t("mx.sum.sheet").slice(0, 31));
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}.xlsx"`,
      "Cache-Control": "private, no-store",
      "X-Export-Count": String(tasks.length),
    },
  });
});
