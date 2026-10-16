import { Suspense } from "react";
import { requireWorkspacePage } from "@/lib/page-context";
import { BrainHub, BRAIN_TABS, type BrainPeriod, type BrainTab } from "@/components/brain/brain-hub";

export const metadata = { title: "Second Brain" };

const PERIODS: BrainPeriod[] = ["day", "week", "month", "year"];

export default async function BrainPage({ params, searchParams }: { params: Promise<{ workspaceSlug: string }>; searchParams: Promise<{ tab?: string; period?: string; view?: string }> }) {
  const { workspaceSlug } = await params;
  const q = await searchParams;
  const { workspace } = await requireWorkspacePage(workspaceSlug);
  // Old links: Daily intelligence / Weekly review now live in Home, Decisions next to the Journal.
  const legacy: Record<string, { tab: BrainTab; period?: BrainPeriod; view?: "decisions" }> = { today: { tab: "home", period: "day" }, weekly: { tab: "home", period: "week" }, decisions: { tab: "journal", view: "decisions" } };
  const mapped = q.tab ? legacy[q.tab] : undefined;
  const tab: BrainTab = mapped?.tab ?? (BRAIN_TABS.includes(q.tab as BrainTab) ? (q.tab as BrainTab) : "home");
  const period = PERIODS.includes(q.period as BrainPeriod) ? (q.period as BrainPeriod) : mapped?.period;
  const view = q.view === "decisions" || mapped?.view === "decisions" ? "decisions" : q.view === "journal" ? "journal" : undefined;
  return (
    <Suspense>
      <BrainHub workspaceId={workspace.id} workspaceSlug={workspaceSlug} tab={tab} period={period} view={view} />
    </Suspense>
  );
}
