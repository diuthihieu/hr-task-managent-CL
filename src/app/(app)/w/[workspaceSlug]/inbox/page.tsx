import { requireWorkspacePage } from "@/lib/page-context";
import { InboxView } from "@/components/notifications/inbox-view";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  await requireWorkspacePage(workspaceSlug);
  return <InboxView />;
}
