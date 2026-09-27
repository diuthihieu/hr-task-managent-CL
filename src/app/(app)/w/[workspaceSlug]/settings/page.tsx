import { requireWorkspacePage } from "@/lib/page-context";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ section?: string }> }) {
  const [{ workspaceSlug }, { section }] = await Promise.all([params, searchParams]);
  const { user, workspace, role } = await requireWorkspacePage(workspaceSlug);
  return <SettingsWorkspace workspaceId={workspace.id} workspaceSlug={workspaceSlug} currentUserId={user.id} currentUserRole={role} isSystemAdmin={user.systemRole === "ADMIN"} initialSection={section} />;
}
