import { timingSafeEqual } from "crypto";
import { getSessionUser, unauthorized, forbidden } from "./authz";

/**
 * Who may register desktop releases: the CI pipeline (Bearer DESKTOP_RELEASE_TOKEN,
 * a server-side secret shared only with GitHub Actions) or a signed-in system admin.
 * Returns the admin's user id, or null for CI.
 */
export async function requireReleasePublisher(req: Request): Promise<string | null> {
  const header = req.headers.get("authorization") ?? "";
  const expected = process.env.DESKTOP_RELEASE_TOKEN ?? "";
  if (header.startsWith("Bearer ")) {
    const given = header.slice(7).trim();
    // Too-short secrets are treated as "not configured" rather than accepted.
    if (expected.length >= 32 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return null;
    throw unauthorized();
  }
  const user = await getSessionUser();
  if (!user) throw unauthorized();
  if (user.systemRole !== "ADMIN") throw forbidden("Admin only");
  return user.id;
}
