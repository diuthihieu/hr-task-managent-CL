import { Suspense } from "react";
import { requireWorkspacePage } from "@/lib/page-context";
import { RecognitionHub, type RecoTab } from "@/components/recognition/recognition-hub";

export const metadata = { title: "Recognition" };

const TABS: RecoTab[] = ["leaderboard", "mine", "rewards", "manage"];

export default async function RecognitionPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { workspaceSlug } = await params;
  const { tab } = await searchParams;
  const { user, workspace } = await requireWorkspacePage(workspaceSlug);
  return (
    <Suspense>
      <RecognitionHub workspaceId={workspace.id} workspaceSlug={workspaceSlug} tab={TABS.includes(tab as RecoTab) ? (tab as RecoTab) : tab === "wall" ? "mine" : "leaderboard"} me={{ id: user.id, name: user.name }} />
    </Suspense>
  );
}
