// Signed "forgot password" tokens (no database, no server-only imports so the
// integration tests can mint one). See password-reset.ts for the flow.
import { createHash, createHmac, timingSafeEqual } from "crypto";

const TTL_MS = 3600_000;
const key = () => {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", s).update("password-reset-v1").digest();
};
const b64 = (b: Buffer) => b.toString("base64url");
export const fingerprint = (u: { passwordHash: string | null; sessionVersion: number }) => createHash("sha256").update(`${u.passwordHash ?? "-"}:${u.sessionVersion}`).digest("base64url").slice(0, 22);

export function resetToken(u: { id: string; passwordHash: string | null; sessionVersion: number }, now = Date.now()) {
  const payload = b64(Buffer.from(JSON.stringify({ u: u.id, f: fingerprint(u), x: now + TTL_MS })));
  return `${payload}.${b64(createHmac("sha256", key()).update(payload).digest())}`;
}

export function readResetToken(token: string, now = Date.now()): { userId: string; fp: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", key()).update(payload).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u: unknown; f: unknown; x: unknown };
    if (typeof p.u !== "string" || typeof p.f !== "string" || typeof p.x !== "number" || p.x < now) return null;
    return { userId: p.u, fp: p.f };
  } catch {
    return null;
  }
}

