import { redirect } from "next/navigation";

// Wikis moved to the main menu. A project's old wiki kept the project's id as its wiki id.
export default async function OldProjectWikiPage({ params }: { params: Promise<{ workspaceSlug: string; projectId: string; pageId: string }> }) {
  const { workspaceSlug, projectId, pageId } = await params;
  redirect(`/w/${workspaceSlug}/wiki/${projectId}/${pageId}`);
}
