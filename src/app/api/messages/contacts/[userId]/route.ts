import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, route, readJson } from "@/lib/authz";
import { uuid } from "@/lib/validation";
import { respondContact } from "@/lib/messaging/service";

type P = { userId: string };

/** accept / decline a request, remove a contact (or cancel my request), block / unblock. */
export const PATCH = route<P>(async (req, { params }) => {
  const user = await requireUser();
  const userId = uuid.parse((await params).userId);
  const { action } = z.object({ action: z.enum(["accept", "decline", "remove", "block", "unblock"]) }).parse(await readJson(req));
  return NextResponse.json(await respondContact(user, userId, action));
});
