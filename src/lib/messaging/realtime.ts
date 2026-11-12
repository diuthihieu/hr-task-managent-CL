// Live updates for Messages through Supabase Realtime Broadcast.
//
// The app signs people in with NextAuth, not Supabase Auth, so Realtime can't tell who is listening.
// Instead each user listens on a topic only they are told: "u:" + an HMAC of their id with the app's
// secret (128 bits, not guessable). The server publishes a bare signal there ("conversation X has a new
// message"); the browser then reads the message through the app's API, where every permission check
// lives. So a leaked topic name reveals at most that something happened, never a message.
// Without NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY realtime is off and the page
// falls back to polling.
import "server-only";
import { createHmac } from "node:crypto";
import { after } from "next/server";

export type RealtimeEvent = "message" | "typing" | "read" | "conversation" | "contact";

export function realtimeConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) return null;
  return { url, key };
}

/** The topic only this user is told (see the file comment). */
export function userTopic(userId: string): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return `u:${createHmac("sha256", secret).update(`woli-chat:${userId}`).digest("hex").slice(0, 32)}`;
}

/** Sends a signal to each user's topic after the response (never delays or fails the request). */
export function publish(userIds: string[], event: RealtimeEvent, payload: Record<string, string | number | boolean | null>) {
  const cfg = realtimeConfig();
  const ids = [...new Set(userIds)];
  if (!cfg || !ids.length) return;
  const job = async () => {
    const res = await fetch(`${cfg.url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: process.env.SUPABASE_SECRET_KEY || cfg.key },
      body: JSON.stringify({ messages: ids.map((id) => ({ topic: userTopic(id), event, payload })) }),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) console.error("[realtime] broadcast failed", res.status);
  };
  const run = () => job().catch((e) => console.error("[realtime] broadcast failed", e instanceof Error ? e.message : e));
  try {
    after(run);
  } catch {
    void run();
  }
}
