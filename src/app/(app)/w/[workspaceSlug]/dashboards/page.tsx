import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DashboardsIndex } from "@/components/dashboard/dashboards-index";

export default async function DashboardsIndexPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { workspaceSlug } = await params;
  const workspace = await prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
  if (!workspace) redirect("/");

  const bases = await prisma.base.findMany({
    where: { workspaceId: workspace.id, archived: false },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      dashboards: { orderBy: { createdAt: "asc" }, select: { id: true, name: true, _count: { select: { blocks: true } } } },
    },
  });

  return (
    <DashboardsIndex
      workspaceSlug={workspaceSlug}
      bases={bases.map((b) => ({
        id: b.id,
        name: b.name,
        dashboards: b.dashboards.map((d) => ({ id: d.id, name: d.name, blockCount: d._count.blocks })),
      }))}
    />
  );
}
