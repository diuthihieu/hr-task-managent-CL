import { Suspense } from "react";
import { requireWorkspacePage } from "@/lib/page-context";
import { BrainHub, type BrainTab } from "@/components/brain/brain-hub";

export const metadata = { title: "Second Brain" };

const TABS: BrainTab[] = ["today", "ask", "journal", "decisions", "health", "weekly"];

export default async function BrainPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { workspaceSlug } = await params;
  const { tab } = await searchParams;
  const { workspace } = await requireWorkspacePage(workspaceSlug);
  return (
    <Suspense>
      <BrainHub workspaceId={workspace.id} workspaceSlug={workspaceSlug} tab={TABS.includes(tab as BrainTab) ? (tab as BrainTab) : "today"} />
    </Suspense>
  );
}
