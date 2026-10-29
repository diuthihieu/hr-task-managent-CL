// Refuse to serve with unsafe configuration. Called once per server start
// (src/instrumentation.ts) in production: a missing, short or placeholder
// AUTH_SECRET would let anyone forge session cookies.

const PLACEHOLDER = /change-?me|replace-?me|placeholder|your[-_]?secret|example/i;

export function configProblems(env: Record<string, string | undefined>): string[] {
  const problems: string[] = [];
  const secret = env.AUTH_SECRET ?? env.NEXTAUTH_SECRET ?? "";
  if (!secret) problems.push("AUTH_SECRET is not set");
  else if (secret.length < 32) problems.push("AUTH_SECRET must be at least 32 characters (generate one with: openssl rand -base64 32)");
  else if (PLACEHOLDER.test(secret)) problems.push("AUTH_SECRET is a placeholder value - generate a real one with: openssl rand -base64 32");
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is not set");
  if (env.BLOB_ACCESS && env.BLOB_ACCESS !== "private" && env.BLOB_ACCESS !== "public") problems.push('BLOB_ACCESS must be "private" or "public"');
  return problems;
}

/** Problems that don't stop the server but weaken a protection; logged at start-up. */
export function configWarnings(env: Record<string, string | undefined>): string[] {
  const warnings: string[] = [];
  if (!env.VERCEL && !env.TRUSTED_PROXY?.trim()) {
    warnings.push("TRUSTED_PROXY is not set: client addresses are unknown, so per-IP rate limits are off (sign-up uses one shared limit). Behind nginx set TRUSTED_PROXY=nginx - see docs/OPERATIONS.md \"Self-hosting\".");
  }
  return warnings;
}

export function assertSafeConfig(env: Record<string, string | undefined> = process.env) {
  const problems = configProblems(env);
  if (problems.length) throw new Error(`[config] Refusing to start:\n - ${problems.join("\n - ")}`);
}
