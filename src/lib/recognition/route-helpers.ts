import "server-only";
import { prisma } from "../prisma";
import { badRequest, requireUser, requireWorkspaceRole } from "../authz";
import { canManageRecognition, canSeeOthersPoints, recognitionSettings, syncPointsIfStale } from "./points";
import { periodRange, type PeriodKind } from "./core";

export async function recoContext(workspaceId: string, opts: { sync?: boolean } = {}) {
  const user = await requireUser();
  const ctx = await requireWorkspaceRole(user, workspaceId, "viewer");
  // Incremental and cheap: keep the numbers on screen current (5 s debounce for parallel requests).
  if (opts.sync !== false) await syncPointsIfStale(workspaceId, 5_000);
  const [canManage, seePoints, settings, ws] = await Promise.all([
    canManageRecognition(user, workspaceId, ctx.role),
    canSeeOthersPoints(user, workspaceId, ctx.role),
    recognitionSettings(workspaceId),
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true, name: true } }),
  ]);
  return { user, ctx, canManage, seePoints, settings, base: `/w/${ws.slug}`, workspaceName: ws.name };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** ?period=week|month|quarter|year|custom&from=YYYY-MM-DD&to=YYYY-MM-DD&top=N */
export function periodFromQuery(url: URL) {
  const kind = (url.searchParams.get("period") ?? "month") as PeriodKind;
  if (!["week", "month", "quarter", "year", "custom"].includes(kind)) throw badRequest("Unknown period");
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw badRequest("Dates must be YYYY-MM-DD");
  const range = periodRange(kind, new Date(), from, to);
  if (range.to <= range.from) throw badRequest("The end date must be after the start date");
  const top = Math.min(100, Math.max(1, Number(url.searchParams.get("top") ?? 10) || 10));
  return { ...range, kind, top };
}
