import { NextResponse } from "next/server";
import { requireUser, route, HttpError } from "@/lib/authz";
import { aiConfigured, generate, geminiModels } from "@/lib/ai/gemini";
import { UNVERIFIED_MESSAGE } from "@/lib/invitations";
import { rateLimit } from "@/lib/rate-limit";

/** Connection check for the settings screens: sends a tiny prompt and reports what happened. */
export const POST = route(async () => {
  const user = await requireUser();
  // The only AI call outside a workspace: verified addresses only, outside the try below (BUG-08).
  if (!user.emailVerifiedAt) throw new HttpError(403, UNVERIFIED_MESSAGE, "email_unverified");
  if (!(await rateLimit(`ai-health:${user.id}`, 5, 10 * 60_000))) throw new HttpError(429, "Too many checks - please wait a few minutes");
  if (!aiConfigured()) return NextResponse.json({ ok: false, configured: false, models: geminiModels(), message: "GEMINI_API_KEY is not set on the server" });
  const started = Date.now();
  try {
    const r = await generate({ workspaceId: null, contents: [{ role: "user", parts: [{ text: "Reply with the single word: pong" }] }], temperature: 0, maxOutputTokens: 64 });
    return NextResponse.json({ ok: true, configured: true, model: r.model, models: geminiModels(), ms: Date.now() - started, reply: r.text.slice(0, 40) });
  } catch (e) {
    return NextResponse.json({ ok: false, configured: true, models: geminiModels(), message: e instanceof HttpError ? e.message : (e as Error).message });
  }
});
