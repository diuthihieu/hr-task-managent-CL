// Which client address to trust for per-IP rate limits (BUG-13). Headers are
// only trusted when a proxy we know sets them; a client can send any header,
// so outside Vercel nothing is trusted unless TRUSTED_PROXY says which proxy
// overwrites what. Pure (no prisma / server-only) so it is unit tested.

export type ProxyMode = "vercel" | "nginx" | "none";

export function resolveProxyMode(env: Record<string, string | undefined> = process.env): ProxyMode {
  const set = env.TRUSTED_PROXY?.trim().toLowerCase();
  if (set) return set === "vercel" || set === "nginx" ? set : "none";
  return env.VERCEL ? "vercel" : "none";
}

/**
 * - vercel: x-vercel-forwarded-for, then x-real-ip (both written by the platform, never the client's).
 * - nginx: x-real-ip only (`proxy_set_header X-Real-IP $remote_addr;` overwrites what the client sent).
 * - none: null. X-Forwarded-For is never read: its first entry is whatever the client put there.
 */
export function readClientIp(headers: Headers, mode: ProxyMode): string | null {
  const raw = mode === "vercel" ? headers.get("x-vercel-forwarded-for")?.split(",")[0] || headers.get("x-real-ip") : mode === "nginx" ? headers.get("x-real-ip") : null;
  const ip = raw?.trim().slice(0, 64);
  return ip || null;
}
