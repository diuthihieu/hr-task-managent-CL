import { requireProjectPage } from "@/lib/page-context";
import { ProjectWorkspace } from "@/components/views/project-workspace";

export default async function ProjectPage({ params }: { params: Promise<{ workspaceSlug: string; projectId: string }> }) {
  const { workspaceSlug, projectId } = await params;
  const { workspace, project } = await requireProjectPage(workspaceSlug, projectId);
  return <ProjectWorkspace projectId={projectId} breadcrumb={{ workspace: workspace.name, project: project.name }} />;
}
