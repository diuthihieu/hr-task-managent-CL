import { requireProjectPage } from "@/lib/page-context";
import { roleAtLeast } from "@/lib/authz";
import { ProjectHeader } from "@/components/projects/project-tabs";
import { OkrListWorkspace } from "@/components/okr/okr-list-workspace";

export default async function ProjectObjectivesPage({ params }: { params: Promise<{ workspaceSlug: string; projectId: string }> }) {
  const { workspaceSlug, projectId } = await params;
  const { workspace, project, role } = await requireProjectPage(workspaceSlug, projectId);
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ProjectHeader workspaceSlug={workspaceSlug} workspaceName={workspace.name} projectId={project.id} projectName={project.name} />
      <OkrListWorkspace workspaceId={workspace.id} workspaceSlug={workspaceSlug} scope="project" projectId={project.id} projectName={project.name} canEdit={roleAtLeast(role, "editor")} />
    </div>
  );
}
