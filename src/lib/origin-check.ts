// CSRF defense in depth for signed-in writes (BUG-15), on top of the SameSite=Lax
// session cookie. A write is refused when the browser says it comes from another
// site. The Origin's host is compared with the host the request came through
// (X-Forwarded-Host or Host, like Next's own Server Actions check), so http/https
// behind a TLS proxy doesn't matter. Requests without Origin (cron, CI, curl) pass
// unless the browser marks them cross-site. Never compare with req.url: when self-
// hosted it carries the address the server binds to, not the public host.
import { appOrigin } from "./app-origin";

const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isCrossSiteWrite(req: Request, env: Record<string, string | undefined> = process.env): boolean {
  if (!WRITES.has(req.method.toUpperCase())) return false;
  const origin = req.headers.get("origin");
  if (origin === null) return req.headers.get("sec-fetch-site") === "cross-site";
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return true; // includes "null"
  }
  const forwarded = req.headers.get("x-forwarded-host")?.split(",")[0]?.trim().toLowerCase();
  const host = req.headers.get("host")?.toLowerCase();
  if (url.host.toLowerCase() === forwarded || url.host.toLowerCase() === host) return false;
  if (url.origin === appOrigin(req, env)) return false;
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  return !allowed.includes(url.origin);
}
