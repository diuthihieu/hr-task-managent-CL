import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { MyWork } from "@/components/okr/my-work";

export default async function MyWorkPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { workspaceSlug } = await params;
  const workspace = await prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
  if (!workspace) redirect("/");

  return <MyWork workspaceId={workspace.id} workspaceSlug={workspaceSlug} />;
}
