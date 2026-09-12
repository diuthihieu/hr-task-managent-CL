import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Database } from "lucide-react";

export default async function WorkspaceHomePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const session = await auth();
  const { workspaceSlug } = await params;
  const workspace = await prisma.workspace.findUnique({ where: { slug: workspaceSlug } });
  if (!workspace) return null;

  const bases = await prisma.base.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { order: "asc" },
    include: { _count: { select: { tables: true } } },
  });

  const name = session?.user?.name?.split(" ")[0] || "there";

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">Welcome back, {name}</h1>
      <p className="text-sm text-neutral-500 mt-1 mb-6">{workspace.name} · {bases.length} base{bases.length === 1 ? "" : "s"}</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {bases.map((base) => (
          <Link
            key={base.id}
            href={`/w/${workspaceSlug}/b/${base.id}`}
            className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 hover:shadow-md hover:border-neutral-300 dark:hover:border-neutral-700 transition-all"
          >
            <div className="h-9 w-9 rounded-md flex items-center justify-center mb-3" style={{ backgroundColor: `${base.color}1a`, color: base.color }}>
              <Database size={18} />
            </div>
            <div className="font-medium text-neutral-900 dark:text-neutral-100 truncate">{base.name}</div>
            <div className="text-xs text-neutral-500 mt-0.5">{base._count.tables} table{base._count.tables === 1 ? "" : "s"}</div>
          </Link>
        ))}
      </div>

      {bases.length === 0 && (
        <div className="text-center py-20 text-neutral-400">
          <Database size={32} className="mx-auto mb-3 opacity-40" />
          <p>No bases yet. Create one from the sidebar to get started.</p>
        </div>
      )}
    </div>
  );
}
