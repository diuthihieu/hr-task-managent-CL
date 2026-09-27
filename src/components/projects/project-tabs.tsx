"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, ListChecks, Target, BookOpen, SlidersHorizontal } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

/** Breadcrumb + section tabs shared by every project page (tasks, objectives, wiki, settings). */
export function ProjectHeader({ workspaceSlug, workspaceName, projectId, projectName, right }: { workspaceSlug: string; workspaceName: string; projectId: string; projectName: string; right?: React.ReactNode }) {
  const { t } = useT();
  const pathname = usePathname();
  const base = `/w/${workspaceSlug}/p/${projectId}`;
  const section = pathname.slice(base.length).split("/")[1] ?? "";
  const tabs = [
    { key: "", label: t("project.tabs.tasks"), icon: ListChecks },
    { key: "objectives", label: t("project.tabs.objectives"), icon: Target },
    { key: "wiki", label: t("project.tabs.wiki"), icon: BookOpen },
    { key: "settings", label: t("project.tabs.settings"), icon: SlidersHorizontal },
  ];
  const active = section === "t" ? "" : section;
  return (
    <div className="flex items-center gap-1.5 h-12 px-4 border-b border-neutral-200 dark:border-neutral-800 shrink-0 text-sm">
      <Link href={`/w/${workspaceSlug}`} className="text-neutral-400 hover:text-neutral-600 truncate max-w-[160px]">{workspaceName}</Link>
      <ChevronRight size={13} className="text-neutral-300 shrink-0" />
      <Link href={base} className="font-medium text-neutral-800 dark:text-neutral-100 truncate max-w-[220px]">{projectName}</Link>
      <nav className="ml-4 flex items-center gap-0.5" aria-label={projectName}>
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key ? `${base}/${tab.key}` : base}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-xs",
              active === tab.key ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            )}
            data-testid={`project-tab-${tab.key || "tasks"}`}
          >
            <tab.icon size={13} /> <span className="hidden md:inline">{tab.label}</span>
          </Link>
        ))}
      </nav>
      {right && <div className="ml-auto flex items-center gap-2 text-xs text-neutral-400">{right}</div>}
    </div>
  );
}
