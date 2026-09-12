import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { NewTableButton } from "./new-table-button";

export default async function BasePage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; baseId: string }>;
}) {
  const { workspaceSlug, baseId } = await params;
  const base = await prisma.base.findUnique({ where: { id: baseId } });
  if (!base) redirect(`/w/${workspaceSlug}`);

  const firstTable = await prisma.tableDef.findFirst({ where: { baseId }, orderBy: { order: "asc" } });
  if (firstTable) redirect(`/w/${workspaceSlug}/b/${baseId}/t/${firstTable.id}`);

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center max-w-sm">
        <h2 className="font-semibold text-neutral-900 dark:text-neutral-100 mb-1">{base.name} has no tables yet</h2>
        <p className="text-sm text-neutral-500 mb-4">Tables hold your records and fields. Create one to get started.</p>
        <NewTableButton baseId={baseId} workspaceSlug={workspaceSlug} />
      </div>
    </div>
  );
}
