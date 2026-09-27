import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePage } from "@/lib/page-context";

export default async function WorkspaceHomePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { user, workspace, role } = await requireWorkspacePage(workspaceSlug);
  const [projects, openTaskCounts] = await Promise.all([
    prisma.project.findMany({ where: { workspaceId: workspace.id, deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.task.groupBy({
      by: ["projectId"],
      where: { workspaceId: workspace.id, deletedAt: null, status: { category: { in: ["todo", "in_progress"] } } },
      _count: { _all: true },
    }),
  ]);
  const openByProject = new Map(openTaskCounts.map((c) => [c.projectId, c._count._all]));
  const canCreate = role === "owner" || role === "admin";

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">Welcome, {user.name.split(" ")[0]}</h1>
      <p className="text-sm text-neutral-500 mt-1 mb-6">
        {workspace.name} · {projects.length} project{projects.length === 1 ? "" : "s"} · your role: {role}
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {projects.map((p) => (
          <Link
            key={p.id}
            href={`/w/${workspaceSlug}/p/${p.id}`}
            className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 hover:shadow-md hover:border-neutral-300 dark:hover:border-neutral-700 transition-all"
          >
            <div className="h-9 w-9 rounded-md flex items-center justify-center mb-3" style={{ backgroundColor: `${p.color}1a`, color: p.color }}>
              <FolderKanban size={18} />
            </div>
            <div className="font-medium text-neutral-900 dark:text-neutral-100 truncate">{p.name}</div>
            <div className="text-xs text-neutral-500 mt-0.5">
              {openByProject.get(p.id) ?? 0} open task{openByProject.get(p.id) === 1 ? "" : "s"} · {p.status.replace("_", " ")}
            </div>
          </Link>
        ))}
      </div>

      {projects.length === 0 && (
        <div className="text-center py-20 text-neutral-400">
          <FolderKanban size={32} className="mx-auto mb-3 opacity-40" />
          <p>No projects yet.</p>
          <p className="text-xs mt-1">
            {canCreate
              ? "Create one with the + next to Projects in the sidebar. Add your task categories under Settings → Task Configuration."
              : "A workspace admin needs to create a project first."}
          </p>
        </div>
      )}
    </div>
  );
}
