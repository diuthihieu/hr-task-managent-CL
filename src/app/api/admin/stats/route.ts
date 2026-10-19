import { NextResponse } from "next/server";
import { requireAdmin, route } from "@/lib/authz";
import { logSecurityEvent } from "@/lib/auth";
import { loadAdminOverview } from "@/lib/admin-stats";

/**
 * Platform overview for woli system administrators (counts only, see src/lib/admin-stats.ts).
 * It lists every workspace's name and owner, including workspaces the admin is not a member of,
 * so each view is written to the security log.
 */
export const GET = route(async (req) => {
  const admin = await requireAdmin();
  const overview = await loadAdminOverview();
  await logSecurityEvent(admin.id, "admin_overview_viewed", `Viewed the platform overview (${overview.workspaces.total} workspaces)`, req);
  return NextResponse.json(overview, { headers: { "cache-control": "no-store" } });
});
