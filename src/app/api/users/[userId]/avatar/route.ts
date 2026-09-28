import { prisma } from "@/lib/prisma";
import { requireUser, route, notFound } from "@/lib/authz";
import { initials } from "@/lib/utils";

type P = { userId: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A user's profile picture, or an SVG with their initials when none was
 * uploaded, so every avatar in the app can simply be an <img>. Visible to the
 * user and to people who share a workspace with them.
 */
export const GET = route<P>(async (_req, { params }) => {
  const me = await requireUser();
  const { userId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw notFound("User");
  if (userId !== me.id && me.systemRole !== "ADMIN") {
    const shared = await prisma.workspaceMember.findFirst({ where: { userId, workspace: { deletedAt: null, members: { some: { userId: me.id } } } }, select: { id: true } });
    if (!shared) throw notFound("User");
  }
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, avatarColor: true, avatarData: true, avatarType: true } });
  if (!u) throw notFound("User");
  const headers = { "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" };
  if (u.avatarData && u.avatarType) return new Response(new Uint8Array(u.avatarData), { headers: { ...headers, "Content-Type": u.avatarType } });
  const color = /^#[0-9a-f]{3,8}$/i.test(u.avatarColor) ? u.avatarColor : "#6366f1";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${color}"/><text x="32" y="32" dy=".35em" text-anchor="middle" font-family="-apple-system,Segoe UI,Arial,sans-serif" font-size="24" font-weight="600" fill="#fff">${esc(initials(u.name))}</text></svg>`;
  return new Response(svg, { headers: { ...headers, "Content-Type": "image/svg+xml" } });
});
