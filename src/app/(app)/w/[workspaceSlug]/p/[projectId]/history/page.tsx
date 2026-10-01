import { requireProjectPage } from "@/lib/page-context";
import { ProjectHeader } from "@/components/projects/project-tabs";
import { ProjectVersionHistory } from "@/components/projects/project-version-history";

export default async function ProjectHistoryPage({ params }: { params: Promise<{ workspaceSlug: string; projectId: string }> }) {
  const { workspaceSlug, projectId } = await params;
  const { workspace, project } = await requireProjectPage(workspaceSlug, projectId);
  return <div className="flex-1 flex flex-col overflow-hidden"><ProjectHeader workspaceSlug={workspaceSlug} workspaceName={workspace.name} projectId={project.id} projectName={project.name} /><ProjectVersionHistory projectId={project.id} /></div>;
}
