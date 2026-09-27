// Best-effort, per-instance rate limiter for unauthenticated endpoints
// (sign-up, sign-in). Serverless instances don't share memory, so this only
// slows down a single client hammering one instance; put a WAF / Vercel
// Firewall rule in front for real abuse protection.

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

export function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
