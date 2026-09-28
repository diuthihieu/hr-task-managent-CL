import { NextResponse, type NextRequest } from "next/server";

// Signed-out visitors opening a workspace link land on the sign-in page with
// the workspace slug, so the page can show that workspace's name and logo
// (also what chat apps display when the link is shared) and return them to
// the link after signing in. Only checks that a session cookie exists; the
// real authorization still happens in the pages and API routes.
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.getAll().some((c) => c.name.endsWith("authjs.session-token") || c.name.includes("authjs.session-token."));
  if (hasSession) return NextResponse.next();
  const slug = request.nextUrl.pathname.split("/")[2];
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  url.searchParams.set("auth", "login");
  if (slug) url.searchParams.set("ws", slug);
  url.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
  url.hash = "auth";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/w/:path*"] };
