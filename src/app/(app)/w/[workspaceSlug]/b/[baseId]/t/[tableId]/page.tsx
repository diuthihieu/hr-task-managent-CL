import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { TableWorkspace } from "@/components/views/table-workspace";

export default async function TablePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; baseId: string; tableId: string }>;
}) {
  const { workspaceSlug, baseId, tableId } = await params;
  const table = await prisma.tableDef.findUnique({
    where: { id: tableId },
    include: { base: { select: { name: true, workspace: { select: { name: true } } } } },
  });
  if (!table) redirect(`/w/${workspaceSlug}/b/${baseId}`);

  return (
    <TableWorkspace
      tableId={tableId}
      baseId={baseId}
      workspaceSlug={workspaceSlug}
      breadcrumb={{ workspace: table.base.workspace.name, base: table.base.name, table: table.name }}
    />
  );
}
