import "server-only";
import { prisma } from "./prisma";
import { readClientIp, resolveProxyMode } from "./client-ip";

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
 * The client address from the trusted proxy's header (see client-ip.ts and
 * TRUSTED_PROXY), or null when it can't be known. For logs; rate limits go
 * through rateLimitByIp so an unknown address never becomes a shared key.
 */
export function clientIp(req: Request | { headers: Headers }): string | null {
  return readClientIp(req.headers, resolveProxyMode());
}

/**
 * Per-IP limit. When the address is unknown, `onUnknown` decides: "skip" (the
 * route's other limits still apply - never one bucket for everyone, which a
 * single stranger could fill to lock everybody out), or a separate shared limit
 * for the rare place where that is the lesser evil (mass sign-up).
 */
export async function rateLimitByIp(
  req: Request | { headers: Headers },
  prefix: string,
  limit: number,
  windowMs: number,
  onUnknown: "skip" | { key: string; limit: number; windowMs: number }
): Promise<boolean> {
  const ip = clientIp(req);
  if (ip) return rateLimit(`${prefix}:${ip}`, limit, windowMs);
  if (onUnknown === "skip") return true;
  return rateLimit(onUnknown.key, onUnknown.limit, onUnknown.windowMs);
}
