import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { badRequest, requireUser, route, readJson } from "@/lib/authz";
import { isPushEndpoint, pushConfigured } from "@/lib/push";

const MAX_DEVICES = 20;
const subSchema = z.object({
  endpoint: z.string().max(1000),
  keys: z.object({ p256dh: z.string().min(20).max(200), auth: z.string().min(8).max(100) }),
});

/** Whether push is set up on the server, and the public key browsers subscribe with. */
export const GET = route(async () => {
  const user = await requireUser();
  const devices = await prisma.pushSubscription.count({ where: { userId: user.id } });
  return NextResponse.json({ enabled: pushConfigured(), publicKey: pushConfigured() ? process.env.VAPID_PUBLIC_KEY : null, devices });
});

/** Register this browser / app for push (re-registering an endpoint moves it to the signed-in user). */
export const POST = route(async (req) => {
  const user = await requireUser();
  if (!pushConfigured()) throw badRequest("Push notifications are not set up on this server");
  const b = subSchema.parse(await readJson(req));
  if (!isPushEndpoint(b.endpoint)) throw badRequest("Not a browser push endpoint");
  const userAgent = (req.headers.get("user-agent") ?? "").slice(0, 300) || null;
  await prisma.pushSubscription.upsert({
    where: { endpoint: b.endpoint },
    create: { userId: user.id, endpoint: b.endpoint, p256dh: b.keys.p256dh, auth: b.keys.auth, userAgent },
    update: { userId: user.id, p256dh: b.keys.p256dh, auth: b.keys.auth, userAgent },
  });
  // Keep the newest devices only.
  const extra = await prisma.pushSubscription.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, skip: MAX_DEVICES, select: { id: true } });
  if (extra.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((x) => x.id) } } });
  return NextResponse.json({ ok: true }, { status: 201 });
});

/** Stop push on this browser / app (sign-out, or the user turned it off). Only the caller's own rows. */
export const DELETE = route(async (req) => {
  const user = await requireUser();
  const b = z.object({ endpoint: z.string().max(1000) }).parse(await readJson(req));
  await prisma.pushSubscription.deleteMany({ where: { userId: user.id, endpoint: b.endpoint } });
  return NextResponse.json({ ok: true });
});
