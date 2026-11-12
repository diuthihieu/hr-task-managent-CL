import { NextResponse } from "next/server";
import { requireUser, route } from "@/lib/authz";
import { searchTasks } from "@/lib/messaging/service";

/** Tasks I can see, for the "#" picker. */
export const GET = route(async (req) => {
  const user = await requireUser();
  return NextResponse.json(await searchTasks(user, new URL(req.url).searchParams.get("q") ?? ""));
});
