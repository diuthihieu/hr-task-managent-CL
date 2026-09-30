import "server-only";
import { prisma } from "./prisma";

// Fixed-window rate limiter shared by every server instance: one atomic
// upsert per hit in the rate_limits table. Keys should combine the account
// (can't be rotated) with the client IP (for anonymous endpoints). If the
// database is unreachable it degrades to a per-instance counter rather than
// failing the request.

const local = new Map<string, { count: number; resetAt: number }>();
function localHit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const b = local.get(key);
  if (!b || b.resetAt < now) {
    if (local.size > 10_000) local.clear();
    local.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

/** Counts one hit for `key`; true while the key is within `limit` hits per `windowMs`. */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const k = key.slice(0, 200);
  try {
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO rate_limits (key, count, reset_at)
      VALUES (${k}, 1, now() + (${windowMs}::int * interval '1 millisecond'))
      ON CONFLICT (key) DO UPDATE SET
        count = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
        reset_at = CASE WHEN rate_limits.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limits.reset_at END
      RETURNING count`;
    // Housekeeping now and then.
    if (Math.random() < 0.01) prisma.$executeRaw`DELETE FROM rate_limits WHERE reset_at < now() - interval '1 day'`.catch(() => {});
    return (rows[0]?.count ?? 1) <= limit;
  } catch (e) {
    console.error("[rate-limit] shared store unavailable, using a local counter", e);
    return localHit(k, limit, windowMs);
  }
}

/** Forget a key (e.g. failed-login counter after a successful sign-in). */
export async function resetRateLimit(key: string) {
  await prisma.$executeRaw`DELETE FROM rate_limits WHERE key = ${key.slice(0, 200)}`.catch(() => {});
}

/**
 * Best available client address. On Vercel `x-vercel-forwarded-for` / `x-real-ip`
 * are set by the platform (not the client). Behind another proxy, make sure it
 * overwrites X-Forwarded-For; account-based keys can't be spoofed either way.
 */
export function clientIp(req: Request | { headers: Headers }): string {
  const h = req.headers;
  return (h.get("x-vercel-forwarded-for")?.split(",")[0] || h.get("x-real-ip") || h.get("x-forwarded-for")?.split(",")[0] || "unknown").trim().slice(0, 64);
}
