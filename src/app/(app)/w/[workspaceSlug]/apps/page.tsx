import { requireWorkspacePage } from "@/lib/page-context";
import { AllFeatures } from "@/components/layout/all-features";

/** "All" (the phone tab bar's first tab): every feature of the menu, grouped. Works on any screen size. */
export default async function AllFeaturesPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  await requireWorkspacePage(workspaceSlug);
  return <AllFeatures />;
}
