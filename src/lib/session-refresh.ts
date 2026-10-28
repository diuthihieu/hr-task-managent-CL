// Short-lived signed proof that lets the current device take the new session
// version right after its own password change (see auth.ts, jwt callback).
// The browser can call update() with any data, so a bare update must never
// raise the version stored in the cookie - only a proof minted by the server can.
import { createHmac, timingSafeEqual } from "crypto";

const TTL_MS = 60_000;
const key = () => {
  const s = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set");
  return createHmac("sha256", s).update("session-refresh-v1").digest();
};
const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

export function sessionRefreshProof(userId: string, sessionVersion: number, now = Date.now()) {
  const payload = `${userId}.${sessionVersion}.${now + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/** True when proof was minted for exactly this user and version and hasn't expired. */
export function verifySessionRefresh(proof: unknown, userId: string, sessionVersion: number, now = Date.now()) {
  if (typeof proof !== "string") return false;
  const i = proof.lastIndexOf(".");
  if (i < 0) return false;
  const payload = proof.slice(0, i);
  const [u, sv, exp] = payload.split(".");
  if (u !== userId || sv !== String(sessionVersion) || !(Number(exp) >= now)) return false;
  const given = Buffer.from(proof.slice(i + 1), "base64url");
  const expected = Buffer.from(sign(payload), "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
