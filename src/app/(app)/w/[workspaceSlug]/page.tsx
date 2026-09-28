import { visibleProjectWhere } from "@/lib/authz";
import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePage } from "@/lib/page-context";
import { getServerT } from "@/lib/prefs";
import { NewProjectButton } from "@/components/projects/new-project-button";
import type { MessageKey } from "@/lib/i18n/core";

export default async function WorkspaceHomePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const [{ user, workspace, role }, { t, locale }] = await Promise.all([requireWorkspacePage(workspaceSlug), getServerT()]);
  const [projects, openTaskCounts] = await Promise.all([
    prisma.project.findMany({ where: { workspaceId: workspace.id, deletedAt: null, ...visibleProjectWhere(user) }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.task.groupBy({
      by: ["projectId"],
      where: { workspaceId: workspace.id, deletedAt: null, project: visibleProjectWhere(user), status: { category: { in: ["todo", "in_progress"] } } },
      _count: { _all: true },
    }),
  ]);
  const openByProject = new Map(openTaskCounts.map((c) => [c.projectId, c._count._all]));
  const canCreate = ["owner", "admin", "editor"].includes(role);

  return (
    <div className="flex-1 overflow-y-auto p-8">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">{t("home.welcome", { name: locale === "vi" ? user.name.split(" ").slice(-1)[0] : user.name.split(" ")[0] })}</h1>
          <p className="text-sm text-neutral-500 mt-1">{t("home.summary", { workspace: workspace.name, count: projects.length, role: t(`role.${role}` as MessageKey) })}</p>
        </div>
        {canCreate && <NewProjectButton workspaceId={workspace.id} workspaceSlug={workspace.slug} />}
      </div>

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
            <div className="text-xs text-neutral-500 mt-0.5">{t("project.openTasks", { count: openByProject.get(p.id) ?? 0 })}</div>
          </Link>
        ))}
      </div>

      {projects.length === 0 && (
        <div className="text-center py-20 text-neutral-400">
          <FolderKanban size={32} className="mx-auto mb-3 opacity-40" />
          <p>{t("home.noProjects")}</p>
          <p className="text-xs mt-1">{canCreate ? t("home.noProjectsHint") : t("home.noProjectsViewer")}</p>
        </div>
      )}
    </div>
  );
}
