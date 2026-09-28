import { requireProjectPage } from "@/lib/page-context";
import { roleAtLeast } from "@/lib/authz";
import { ProjectHeader } from "@/components/projects/project-tabs";
import { WikiWorkspace } from "@/components/wiki/wiki-workspace";

export default async function WikiPageRoute({ params }: { params: Promise<{ workspaceSlug: string; projectId: string; pageId: string }> }) {
  const { workspaceSlug, projectId, pageId } = await params;
  const { user, workspace, project, role } = await requireProjectPage(workspaceSlug, projectId);
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ProjectHeader workspaceSlug={workspaceSlug} workspaceName={workspace.name} projectId={project.id} projectName={project.name} />
      <WikiWorkspace projectId={project.id} projectName={project.name} workspaceSlug={workspaceSlug} pageId={pageId} canEdit={roleAtLeast(role, "contributor")} canDeleteAny={roleAtLeast(role, "editor")} currentUserName={user.name} />
    </div>
  );
}
