import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requirePageUser } from "@/lib/page-context";
import { SignOutButton } from "@/components/account/sign-out-button";

export default async function RootPage() {
  const user = await requirePageUser();
  const workspace =
    user.systemRole === "ADMIN"
      ? await prisma.workspace.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } })
      : (await prisma.workspaceMember.findFirst({ where: { userId: user.id, workspace: { deletedAt: null } }, include: { workspace: true }, orderBy: { createdAt: "asc" } }))?.workspace;
  if (workspace) redirect(`/w/${workspace.slug}`);
  if (user.systemRole === "ADMIN") redirect("/admin");
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-neutral-950 p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-50">No workspace yet</h1>
        <p className="text-sm text-neutral-500 mt-2">Your account isn&apos;t a member of any workspace. Ask an administrator to add you.</p>
        <SignOutButton />
      </div>
    </div>
  );
}
