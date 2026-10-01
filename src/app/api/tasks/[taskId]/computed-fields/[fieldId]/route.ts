import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertCanEditTask, badRequest, HttpError, requireUser, requireWorkspaceRole, route, workspaceOfTask } from "@/lib/authz";
import { aiConfigured, generate } from "@/lib/ai/gemini";
import { taskContext } from "@/lib/ai/actions";
import { rateLimit } from "@/lib/rate-limit";
import { logActivity } from "@/lib/activity";
import type { FieldConfig } from "@/lib/field-types";

type P = { taskId: string; fieldId: string };

function privateAddress(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const n = ip.toLowerCase();
  return n === "::1" || n === "::" || n.startsWith("fc") || n.startsWith("fd") || n.startsWith("fe80:") || n.startsWith("::ffff:10.") || n.startsWith("::ffff:127.") || n.startsWith("::ffff:192.168.");
}

async function safeApiUrl(template: string, taskId: string, projectId: string) {
  const rendered = template.replaceAll("{taskId}", encodeURIComponent(taskId)).replaceAll("{projectId}", encodeURIComponent(projectId));
  let url: URL;
  try {
    url = new URL(rendered);
  } catch {
    throw badRequest("API Result URL is invalid");
  }
  if (url.protocol !== "https:" || url.username || url.password) throw badRequest("API Result only supports credential-free HTTPS URLs");
  const allowed = (process.env.API_FIELD_ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) throw new HttpError(503, "API Result is disabled until API_FIELD_ALLOWED_HOSTS is configured");
  if (!allowed.includes(url.hostname.toLowerCase())) throw new HttpError(403, "This API hostname is not allow-listed");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => privateAddress(a.address))) throw new HttpError(403, "API Result cannot connect to private or local network addresses");
  return url;
}

function jsonPath(value: unknown, path: string | undefined) {
  if (!path?.trim()) return value;
  let cursor = value;
  for (const part of path.split(".").filter(Boolean)) {
    if (cursor === null || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

export const POST = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  const { taskId, fieldId } = await params;
  const ctx = await requireWorkspaceRole(user, await workspaceOfTask(taskId), "contributor");
  await assertCanEditTask(ctx, taskId);
  if (!(await rateLimit(`computed-field:${user.id}`, 60, 10 * 60_000))) throw new HttpError(429, "Too many refreshes - please wait a few minutes");

  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { projectId: true, title: true } });
  const field = await prisma.customField.findFirst({ where: { id: fieldId, projectId: task.projectId, deletedAt: null }, select: { id: true, name: true, type: true, settings: true } });
  if (!field || (field.type !== "ai_field" && field.type !== "api_result")) throw badRequest("This field cannot be refreshed");
  const config = (field.settings ?? {}) as FieldConfig;

  let value: unknown;
  if (field.type === "ai_field") {
    if (!aiConfigured()) throw new HttpError(503, "AI is not configured on this server (GEMINI_API_KEY missing)");
    if (!config.aiPrompt?.trim()) throw badRequest("Configure an AI prompt for this field first");
    const context = await taskContext(taskId);
    const result = await generate({
      workspaceId: ctx.workspaceId,
      system: "Compute one task field from the supplied task context. Follow the field instruction exactly. Return only the field value, with no preamble or Markdown fence.",
      contents: [{ role: "user", parts: [{ text: `FIELD INSTRUCTION:\n${config.aiPrompt}\n\nTASK CONTEXT:\n${context}` }] }],
      temperature: 0.1,
      maxOutputTokens: 2048,
    });
    value = result.text.trim().slice(0, 20_000);
  } else {
    if (!config.apiUrl?.trim()) throw badRequest("Configure an HTTPS URL for this API Result field first");
    const url = await safeApiUrl(config.apiUrl, taskId, task.projectId);
    const response = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new HttpError(502, `API Result returned HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > 64 * 1024) throw new HttpError(502, "API Result response is larger than 64 KB");
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 64 * 1024) throw new HttpError(502, "API Result response is larger than 64 KB");
    try {
      value = jsonPath(JSON.parse(new TextDecoder().decode(bytes)), config.apiJsonPath);
    } catch {
      throw new HttpError(502, "API Result did not return valid JSON");
    }
  }

  await prisma.$transaction(async (tx) => {
    const base = {
      valueText: field.type === "ai_field" ? String(value ?? "") : null,
      valueNumber: null,
      valueDate: null,
      valueBool: null,
      valueOptionId: null,
      valueUserId: null,
      valueTeamId: null,
      valueTaskIds: [],
      valueOptionIds: [],
      valueJson: field.type === "api_result" ? (value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue)) : Prisma.DbNull,
      updatedById: user.id,
    };
    await tx.taskCustomFieldValue.upsert({
      where: { taskId_customFieldId: { taskId, customFieldId: fieldId } },
      create: { taskId, customFieldId: fieldId, ...base },
      update: base,
    });
    await tx.task.update({ where: { id: taskId }, data: { updatedById: user.id } });
    await logActivity(tx, { workspaceId: ctx.workspaceId, actorId: user.id, entityType: "task", entityId: taskId, action: "updated", summary: `Refreshed computed field "${field.name}"` });
  });

  return NextResponse.json({ value });
});
