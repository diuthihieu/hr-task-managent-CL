import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ObjectiveDetail } from "@/components/okr/objective-detail";

export default async function ObjectiveDetailPage({ params }: { params: Promise<{ workspaceSlug: string; objectiveId: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { workspaceSlug, objectiveId } = await params;
  const workspace = await prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
  if (!workspace) redirect("/");

  return <ObjectiveDetail objectiveId={objectiveId} workspaceId={workspace.id} workspaceSlug={workspaceSlug} />;
}
