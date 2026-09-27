import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireWorkspacePage } from "@/lib/page-context";
import { ProjectWorkspace } from "@/components/views/project-workspace";

export default async function ProjectPage({ params }: { params: Promise<{ workspaceSlug: string; projectId: string }> }) {
  const { workspaceSlug, projectId } = await params;
  const { workspace } = await requireWorkspacePage(workspaceSlug);
  const project = await prisma.project.findFirst({ where: { id: projectId, workspaceId: workspace.id, deletedAt: null }, select: { name: true } });
  if (!project) redirect(`/w/${workspaceSlug}`);
  return <ProjectWorkspace projectId={projectId} breadcrumb={{ workspace: workspace.name, project: project.name }} />;
}
