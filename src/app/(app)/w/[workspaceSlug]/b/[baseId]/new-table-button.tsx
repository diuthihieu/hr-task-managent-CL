"use client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Plus } from "lucide-react";

export function NewTableButton({ baseId, workspaceSlug }: { baseId: string; workspaceSlug: string }) {
  const router = useRouter();
  async function create(template?: string) {
    try {
      const res = await api.post<{ table: { id: string } }>(`/api/bases/${baseId}/tables`, {
        name: template === "task" ? "Tasks" : "Untitled Table",
        template,
      });
      router.push(`/w/${workspaceSlug}/b/${baseId}/t/${res.table.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create table");
    }
  }
  return (
    <div className="flex gap-2 justify-center">
      <Button variant="secondary" onClick={() => create()}>
        <Plus size={14} /> Blank table
      </Button>
      <Button onClick={() => create("task")}>
        <Plus size={14} /> Task template
      </Button>
    </div>
  );
}
