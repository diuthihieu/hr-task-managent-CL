import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route, readJson, badRequest } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import { listMessages, sendMessage, updateGroup, MESSAGE_MAX } from "@/lib/messaging/service";

type P = { conversationId: string };

/** A page of messages (?before=<ISO time> for older ones). */
export const GET = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const id = uuid.parse((await params).conversationId);
  const raw = new URL(req.url).searchParams.get("before");
  const before = raw ? new Date(raw) : undefined;
  if (before && Number.isNaN(before.getTime())) throw badRequest("Invalid date");
  return NextResponse.json(await listMessages(user, id, before), { headers: { "Cache-Control": "private, no-store" } });
});

const send = z.object({ body: z.string().max(MESSAGE_MAX + 100), taskIds: z.array(uuid).max(10).optional() });

export const POST = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const id = uuid.parse((await params).conversationId);
  return NextResponse.json(await sendMessage(user, id, send.parse(await readJson(req))), { status: 201 });
});

const patch = z.object({
  name: z.string().max(120).optional(),
  add: z.array(uuid).max(99).optional(),
  remove: z.array(uuid).max(99).optional(),
  leave: z.boolean().optional(),
  muted: z.boolean().optional(),
});

/** Group: rename / add / remove (admins), leave; any conversation: mute. */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const id = uuid.parse((await params).conversationId);
  await updateGroup(user, id, patch.parse(await readJson(req)));
  return NextResponse.json({ ok: true });
});
