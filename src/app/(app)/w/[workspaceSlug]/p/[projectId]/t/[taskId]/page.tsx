import { requireProjectPage } from "@/lib/page-context";
import { ProjectHeader } from "@/components/projects/project-tabs";
import { RecordPage } from "@/components/record/record-page";

export default async function TaskPage({ params }: { params: Promise<{ workspaceSlug: string; projectId: string; taskId: string }> }) {
  const { workspaceSlug, projectId, taskId } = await params;
  const { user, workspace, project } = await requireProjectPage(workspaceSlug, projectId);
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ProjectHeader workspaceSlug={workspaceSlug} workspaceName={workspace.name} projectId={project.id} projectName={project.name} />
      <RecordPage projectId={project.id} taskId={taskId} workspaceSlug={workspaceSlug} currentUserId={user.id} />
    </div>
  );
}
