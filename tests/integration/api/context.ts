// Shared state for the integration scenario: the files in ./ run in order (see ../api.test.ts) and
// build on each other, so the clients, ids and helpers live here.

import { PrismaClient } from "@prisma/client";
import { Client } from "../client";

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@integration.test";
export const ADMIN_BOOTSTRAP_PASSWORD = process.env.ADMIN_PASSWORD ?? "Bootstrap123";
export const ADMIN_PASSWORD = "AdminPass456";

export const prisma = new PrismaClient();
export const admin = new Client();
export const contributor = new Client();
export const viewer = new Client();
export const outsider = new Client();

export const s: Record<string, string> = {};

export type Rec = { id: string; data: Record<string, unknown> };

export type Notif = { id: string; type: string; title: string; read: boolean; link: string | null; data: Record<string, unknown> | null };

export const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3100";
export const STUB = `http://localhost:${process.env.GEMINI_STUB_PORT ?? 3999}`;
export const PNG_1PX = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

export async function upload(client: Client, method: string, path: string, name: string, bytes: Uint8Array | string, type: string) {
  const form = new FormData();
  form.append("file", new Blob([bytes as BlobPart], { type }), name);
  const res = await fetch(`${BASE}${path}`, { method, body: form, headers: { cookie: client.cookieHeader() } });
  return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

export async function ask(client: Client, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/ai/chat`, { method: "POST", headers: { cookie: client.cookieHeader(), "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, conversationId: res.headers.get("x-conversation-id"), text: await res.text() };
}

export async function lastModelRequest() {
  return (await (await fetch(`${STUB}/last`)).json()) as { url: string; apiKey: string; body: { systemInstruction?: { parts: { text: string }[] }; contents: { role: string; parts: { text?: string }[] }[] } };
}

export async function postWithFiles(client: Client, path: string, payload: Record<string, unknown>, files: { name: string; bytes: Uint8Array | string; type: string }[]) {
  const form = new FormData();
  form.set("payload", JSON.stringify(payload));
  for (const f of files) form.append("files", new Blob([f.bytes as BlobPart], { type: f.type }), f.name);
  const res = await fetch(`${BASE}${path}`, { method: "POST", body: form, headers: { cookie: client.cookieHeader() } });
  return { status: res.status, conversationId: res.headers.get("x-conversation-id"), text: await res.text() };
}
export type ModelPart = { text?: string; inlineData?: { mimeType: string; data: string } };

export async function intake(client: Client, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/ai/task-intake`, { method: "POST", headers: { cookie: client.cookieHeader(), "content-type": "application/json" }, body: JSON.stringify({ timeZone: "Asia/Ho_Chi_Minh", ...body }) });
  return {
    status: res.status,
    body: (await res.json().catch(() => null)) as {
      type: string;
      message: string;
      canCreate: boolean;
      draft: { projectId: string | null; title: string; dueDate: string | null; dueTime: string | null; priority: string; assignees: { id: string }[]; missing: string[] } | null;
    },
  };
}
export const say = (...texts: string[]) => texts.map((content, i) => ({ role: i % 2 ? "model" : "user", content }));

export async function action(client: Client, body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/ai/action`, { method: "POST", headers: { cookie: client.cookieHeader(), "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, type: res.headers.get("content-type") ?? "", text: await res.text() };
}
export type NotifList = { unread: number; items: { id: string; type: string; taskId: string | null; actioned: boolean; snoozedUntil: string | null }[] };
