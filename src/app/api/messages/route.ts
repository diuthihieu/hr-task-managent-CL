import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route, readJson } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import { createGroup, listConversations, openDirect } from "@/lib/messaging/service";

/** My conversations, newest first (the Woli AI inbox is always there). */
export const GET = route(async () => {
  const user = await requireUser();
  return NextResponse.json(await listConversations(user));
});

const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct"), userId: uuid }),
  z.object({ kind: z.literal("group"), name: z.string().trim().min(1).max(120), memberIds: z.array(uuid).min(1).max(99) }),
]);

/** Opens the 1-1 chat with a contact, or creates a group. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const b = body.parse(await readJson(req));
  const id = b.kind === "direct" ? await openDirect(user, b.userId) : await createGroup(user, b.name, b.memberIds);
  return NextResponse.json({ id }, { status: 201 });
});
