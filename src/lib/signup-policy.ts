// Who may create a new account (BUG-08). SIGNUP_ALLOWED_DOMAINS is a comma
// separated list of email domains; empty (the default) keeps sign-up open, since
// many separate teams use the app. Exact domain after the last @, any case:
// subdomains don't match. Pure (no prisma) so it is unit tested; the "has a live
// invitation" exception is checked by the callers.
export function signupDomainAllowed(email: string, env: Record<string, string | undefined> = process.env): boolean {
  const allowed = (env.SIGNUP_ALLOWED_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return true;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return allowed.includes(email.slice(at + 1).trim().toLowerCase());
}
