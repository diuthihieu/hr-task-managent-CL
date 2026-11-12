import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route, readJson } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import { listContacts, requestContact } from "@/lib/messaging/service";

export const GET = route(async () => {
  const user = await requireUser();
  return NextResponse.json(await listContacts(user));
});

/** Sends a contact request (or accepts theirs). Only people sharing a workspace with me. */
export const POST = route(async (req) => {
  const user = await requireUser();
  const { userId } = z.object({ userId: uuid }).parse(await readJson(req));
  return NextResponse.json(await requestContact(user, userId));
});
