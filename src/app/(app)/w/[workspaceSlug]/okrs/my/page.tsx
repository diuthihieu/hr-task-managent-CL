import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { OkrListWorkspace } from "@/components/okr/okr-list-workspace";

export default async function MyOkrsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { workspaceSlug } = await params;
  const workspace = await prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
  if (!workspace) redirect("/");

  return <OkrListWorkspace workspaceId={workspace.id} workspaceSlug={workspaceSlug} scope="mine" />;
}
