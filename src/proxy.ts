import { NextResponse, type NextRequest } from "next/server";

const MARKETING = new Set(["/", "/privacy", "/terms"]);

// Script CSP with a fresh nonce per HTML request, in Report-Only mode for now
// (BUG-10): violations go to /api/csp-report before it is switched to blocking.
// No default-src / style-src / img-src on purpose: inline styles, Markdown images
// from any host and framed PDF previews would bury real script violations.
function scriptPolicy(nonce: string) {
  const dev = process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : "";
  return `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev}; object-src 'none'; base-uri 'self'; report-uri /api/csp-report`;
}

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Signed-out visitors opening a workspace link land on the sign-in page with
  // the workspace slug, so the page can show that workspace's name and logo
  // (also what chat apps display when the link is shared) and return them to
  // the link after signing in. Only checks that a session cookie exists; the
  // real authorization still happens in the pages and API routes.
  if (path === "/w" || path.startsWith("/w/")) {
    const hasSession = request.cookies.getAll().some((c) => c.name.endsWith("authjs.session-token") || c.name.includes("authjs.session-token."));
    if (!hasSession) {
      const slug = path.split("/")[2];
      const url = request.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      url.searchParams.set("auth", "login");
      if (slug) url.searchParams.set("ws", slug);
      url.searchParams.set("callbackUrl", path + request.nextUrl.search);
      url.hash = "auth";
      return NextResponse.redirect(url);
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = scriptPolicy(nonce);
  const headers = new Headers(request.headers);
  // Next takes the nonce from the request's CSP header: never let a client choose it.
  headers.delete("content-security-policy");
  headers.set("content-security-policy-report-only", policy);
  headers.set("x-nonce", nonce);
  // The public landing page always uses the brand look (orange, neutral
  // surfaces); the root layout reads this header instead of the visitor's
  // saved accent / tone, which only apply inside the app.
  if (MARKETING.has(path)) headers.set("x-woli-marketing", "1");
  else headers.delete("x-woli-marketing");
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy-Report-Only", policy);
  return response;
}

// Every page (HTML), not API routes or static files. No prefetch exclusion:
// workspace prefetches must still get the sign-in redirect.
export const config = { matcher: ["/((?!api/|_next/static|_next/image|.*\\.[A-Za-z0-9]+$).*)"] };
