import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route, readJson } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import { editMessage, recallMessage, MESSAGE_MAX } from "@/lib/messaging/service";

type P = { messageId: string };

/** Edit my message (within an hour). */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const id = uuid.parse((await params).messageId);
  await editMessage(user, id, z.object({ body: z.string().max(MESSAGE_MAX + 100), taskIds: z.array(uuid).max(10).optional() }).parse(await readJson(req)));
  return NextResponse.json({ ok: true });
});

/** Recall my message (within an hour): gone for everyone, "message recalled" stays. */
export const DELETE = route<P>(async (_req, { params }) => {
  const user = await requireUser();
  await recallMessage(user, uuid.parse((await params).messageId));
  return NextResponse.json({ ok: true });
});
