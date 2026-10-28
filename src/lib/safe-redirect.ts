// Where to send someone after signing in (?callbackUrl=). Browsers treat "\" like "/"
// and drop tabs/newlines, so "/\evil.com" or "/<tab>/evil.com" would leave the site;
// only plain same-origin paths are kept. No server-only imports, so it is unit tested.

const UNSAFE = /[\\\u0000-\u001f\u007f]/;

export function safeRedirectPath(value: unknown, fallback = "/workspaces"): string {
  if (typeof value !== "string" || UNSAFE.test(value) || !/^\/(?![/\\])/.test(value)) return fallback;
  try {
    return new URL(value, "http://x").origin === "http://x" ? value : fallback;
  } catch {
    return fallback;
  }
}
