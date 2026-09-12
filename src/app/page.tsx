import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function RootPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const membership = await prisma.workspaceMember.findFirst({
    where: { userId: (session.user as { id: string }).id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  if (!membership) redirect("/login");
  redirect(`/w/${membership.workspace.slug}`);
}
