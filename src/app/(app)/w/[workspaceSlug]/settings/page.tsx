import { requireWorkspacePage } from "@/lib/page-context";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";

export default async function SettingsPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const { user, workspace, role } = await requireWorkspacePage(workspaceSlug);
  return <SettingsWorkspace workspaceId={workspace.id} workspaceSlug={workspaceSlug} currentUserId={user.id} currentUserRole={role} isSystemAdmin={user.systemRole === "ADMIN"} />;
}
