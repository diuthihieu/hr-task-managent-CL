"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/components/i18n-provider";
import { NewProjectDialog } from "./new-project-dialog";

export function NewProjectButton({ workspaceId, workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="home-new-project">
        <Plus size={15} /> {t("nav.newProject")}
      </Button>
      <NewProjectDialog open={open} onOpenChange={setOpen} workspaceId={workspaceId} workspaceSlug={workspaceSlug} />
    </>
  );
}
