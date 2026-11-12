import { requireWorkspacePage } from "@/lib/page-context";
import { MessagesApp } from "@/components/messages/messages-app";

export const metadata = { title: "Messages" };

/** Messages are personal (across workspaces); the workspace only provides the shell around them. */
export default async function MessagesPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ c?: string; tab?: string }> }) {
  const { workspaceSlug } = await params;
  const { c, tab } = await searchParams;
  const { user } = await requireWorkspacePage(workspaceSlug);
  const conversationId = c && /^[0-9a-f-]{36}$/i.test(c) ? c : null;
  return (
    <div className="h-[calc(100dvh-3.5rem)] min-h-0">
      <MessagesApp meId={user.id} initialConversationId={conversationId} initialTab={tab === "contacts" ? "contacts" : "chats"} />
    </div>
  );
}
