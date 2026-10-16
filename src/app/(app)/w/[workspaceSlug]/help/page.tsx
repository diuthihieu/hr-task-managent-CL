import { requireWorkspacePage } from "@/lib/page-context";
import { HelpCenter } from "@/components/help/help-center";

export default async function HelpPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ tab?: string; topic?: string }> }) {
  const [{ workspaceSlug }, { tab, topic }] = await Promise.all([params, searchParams]);
  await requireWorkspacePage(workspaceSlug);
  return <HelpCenter workspaceSlug={workspaceSlug} initialTab={tab} initialTopic={topic} />;
}
