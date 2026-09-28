import { prisma } from "@/lib/prisma";
import { route } from "@/lib/authz";

type P = { slug: string };

/**
 * Workspace logo by slug. Public on purpose: browsers request favicons and
 * chat apps unfurl links without a session. It only reveals the image.
 */
export const GET = route<P>(async (req, { params }) => {
  const { slug } = await params;
  const w = await prisma.workspace.findFirst({ where: { slug, deletedAt: null }, select: { logoData: true, logoMimeType: true } });
  if (!w?.logoData || !w.logoMimeType) return new Response("Not found", { status: 404 });
  const versioned = new URL(req.url).searchParams.has("v");
  return new Response(new Uint8Array(w.logoData), {
    headers: {
      "Content-Type": w.logoMimeType,
      "Content-Length": String(w.logoData.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=300",
    },
  });
});
