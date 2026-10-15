// The app's own public origin for links that carry a secret (password reset,
// email verification). Never taken from the request's Host header, which a
// misconfigured proxy may let a caller choose: the configured AUTH_URL first,
// then the URLs Vercel itself sets, and the request origin only in local dev.
export function appOrigin(req: Request, env: Record<string, string | undefined> = process.env): string {
  const configured = env.AUTH_URL || env.APP_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // fall through to the platform URLs
    }
  }
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return new URL(req.url).origin;
}
