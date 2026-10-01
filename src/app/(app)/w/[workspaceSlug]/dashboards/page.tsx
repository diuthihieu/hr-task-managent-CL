import { requireWorkspacePage } from "@/lib/page-context";
import { DashboardsIndex } from "@/components/dashboard/dashboards-index";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

export default async function DashboardsIndexPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { workspace, role } = await requireWorkspacePage(workspaceSlug);
  const first = await prisma.dashboard.findFirst({ where: { workspaceId: workspace.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
  if (first) redirect(`/w/${workspaceSlug}/dash/${first.id}`);
  return <DashboardsIndex workspaceId={workspace.id} workspaceSlug={workspaceSlug} canEdit={["owner", "admin", "editor"].includes(role)} />;
}
