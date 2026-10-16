import { requireProjectPage } from "@/lib/page-context";
import { roleAtLeast } from "@/lib/authz";
import { projectCaps } from "@/lib/project-permissions";
import { fromDateOnly } from "@/lib/task-grid";
import { ProjectHeader } from "@/components/projects/project-tabs";
import { ProjectSettings } from "@/components/projects/project-settings";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ workspaceSlug: string; projectId: string }> }) {
  const { workspaceSlug, projectId } = await params;
  const { user, workspace, project, role } = await requireProjectPage(workspaceSlug, projectId);
  // Owner / workspace admin: owner, permissions, deleting. Settings themselves can be delegated.
  const canOwn = roleAtLeast(role, "admin") || (roleAtLeast(role, "editor") && (project.ownerId === user.id || project.createdById === user.id));
  const caps = await projectCaps({ user, role }, project.id);
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <ProjectHeader workspaceSlug={workspaceSlug} workspaceName={workspace.name} projectId={project.id} projectName={project.name} />
      <ProjectSettings
        project={{ id: project.id, name: project.name, description: project.description, color: project.color, icon: project.icon, status: project.status, ownerId: project.ownerId, startDate: fromDateOnly(project.startDate), endDate: fromDateOnly(project.endDate) }}
        workspaceId={workspace.id}
        workspaceSlug={workspaceSlug}
        canManage={caps.has("settings.manage")}
        canOwn={canOwn}
        canEditCategories={caps.has("settings.manage")}
      />
    </div>
  );
}
