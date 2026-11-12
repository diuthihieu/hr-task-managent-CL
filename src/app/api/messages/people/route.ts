import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/authz";
import { searchPeople } from "@/lib/messaging/service";

/** People sharing a workspace with me (search by name or email). */
export const GET = route(async (req) => {
  const user = await requireUser();
  return NextResponse.json(await searchPeople(user, new URL(req.url).searchParams.get("q") ?? ""));
});
