"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  LayoutGrid,
  LayoutDashboard,
  Plus,
  Settings,
  Sheet,
  BookTemplate,
  Search,
  Sun,
  Moon,
  LogOut,
  Workflow as WorkflowIcon,
  Target,
  Briefcase,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { initials, cn } from "@/lib/utils";
import { CommandPalette } from "./command-palette";

interface TableLite { id: string; name: string; icon: string }
interface DashboardLite { id: string; name: string }
interface BaseLite { id: string; name: string; icon: string; color: string; tables: TableLite[]; dashboards: DashboardLite[] }
interface WorkspaceLite { id: string; name: string; slug: string }

export function WorkspaceShell({
  workspace,
  workspaces,
  bases,
  user,
  children,
}: {
  workspace: WorkspaceLite;
  workspaces: WorkspaceLite[];
  bases: BaseLite[];
  user: { id: string; name: string; email: string };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [expanded, setExpanded] = useState<Set<string>>(new Set(bases.map((b) => b.id)));
  const [newBaseOpen, setNewBaseOpen] = useState(false);
  const [newBaseName, setNewBaseName] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const activeBaseId = pathname.match(/\/b\/([^/]+)/)?.[1];
  const activeTableId = pathname.match(/\/t\/([^/]+)/)?.[1];
  const activeDashboardId = pathname.match(/\/dash\/([^/]+)/)?.[1];
  const isMyWork = pathname.includes("/my-work");
  const isTeamOkrs = /\/okrs$/.test(pathname);
  const isMyOkrs = pathname.endsWith("/okrs/my");
  const isOkrDashboard = pathname.endsWith("/okrs/dashboard");
  const isOkrDetail = /\/okrs\/[^/]+$/.test(pathname) && !isMyOkrs && !isOkrDashboard && !isTeamOkrs;

  function toggleExpand(baseId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(baseId)) next.delete(baseId);
      else next.add(baseId);
      return next;
    });
  }

  async function createBase() {
    try {
      const base = await api.post<{ id: string }>(`/api/workspaces/${workspace.id}/bases`, { name: newBaseName || "Untitled Base" });
      setNewBaseOpen(false);
      setNewBaseName("");
      router.push(`/w/${workspace.slug}/b/${base.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create base");
    }
  }

  async function createTable(baseId: string) {
    try {
      const res = await api.post<{ table: { id: string } }>(`/api/bases/${baseId}/tables`, { name: "Untitled Table" });
      router.push(`/w/${workspace.slug}/b/${baseId}/t/${res.table.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create table");
    }
  }

  async function createDashboard(baseId: string) {
    try {
      const dashboard = await api.post<{ id: string }>(`/api/bases/${baseId}/dashboards`, { name: "Untitled Dashboard" });
      router.push(`/w/${workspace.slug}/b/${baseId}/dash/${dashboard.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create dashboard");
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-neutral-50 dark:bg-neutral-950 text-sm">
      {/* Sidebar */}
      <aside className="w-60 shrink-0 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col">
        <div className="h-12 flex items-center gap-2 px-3 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-2 flex-1 rounded-md px-1.5 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800 min-w-0">
                <div className="h-6 w-6 rounded-md bg-indigo-600 flex items-center justify-center text-white shrink-0">
                  <LayoutGrid size={14} />
                </div>
                <span className="font-semibold text-neutral-900 dark:text-neutral-50 truncate">{workspace.name}</span>
                <ChevronDown size={13} className="text-neutral-400 shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              {workspaces.map((w) => (
                <DropdownMenuItem key={w.id} onSelect={() => router.push(`/w/${w.slug}`)}>
                  <span className={cn("truncate", w.slug === workspace.slug && "font-semibold")}>{w.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={async () => {
                  const name = prompt("New workspace name");
                  if (!name) return;
                  const ws = await api.post<{ slug: string }>("/api/workspaces", { name });
                  router.push(`/w/${ws.slug}`);
                }}
              >
                <Plus size={14} /> New workspace
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <nav className="flex-1 overflow-y-auto thin-scroll py-2 px-2 space-y-0.5">
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800 mb-2"
          >
            <Search size={14} />
            <span className="flex-1 text-left">Search</span>
            <kbd className="text-[10px] px-1 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-400">Ctrl K</kbd>
          </button>

          <Link
            href={`/w/${workspace.slug}/my-work`}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 mb-2",
              isMyWork ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
            )}
          >
            <Briefcase size={14} />
            <span className="flex-1 text-left">My Work</span>
          </Link>

          <div className="mb-2">
            <div className="px-2 mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-neutral-400 uppercase tracking-wide">
              <Target size={12} /> OKRs
            </div>
            <Link
              href={`/w/${workspace.slug}/okrs`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 ml-1",
                isTeamOkrs || isOkrDetail ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              )}
            >
              <span className="flex-1 text-left text-sm">Team OKRs</span>
            </Link>
            <Link
              href={`/w/${workspace.slug}/okrs/my`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 ml-1",
                isMyOkrs ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              )}
            >
              <span className="flex-1 text-left text-sm">My OKRs</span>
            </Link>
            <Link
              href={`/w/${workspace.slug}/okrs/dashboard`}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1 ml-1",
                isOkrDashboard ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium" : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
              )}
            >
              <span className="flex-1 text-left text-sm">Dashboard</span>
            </Link>
          </div>

          <div className="mt-1 mb-1 px-2 flex items-center justify-between text-xs font-semibold text-neutral-400 uppercase tracking-wide">
            <span>Bases</span>
            <button onClick={() => setNewBaseOpen(true)} className="hover:text-neutral-700 dark:hover:text-neutral-200">
              <Plus size={13} />
            </button>
          </div>

          {bases.map((base) => (
            <div key={base.id}>
              <div
                className={cn(
                  "group flex items-center gap-1 rounded-md px-1.5 py-1.5 cursor-pointer",
                  activeBaseId === base.id ? "bg-neutral-100 dark:bg-neutral-800" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                )}
              >
                <button onClick={() => toggleExpand(base.id)} className="text-neutral-400 shrink-0">
                  {expanded.has(base.id) ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <Link href={`/w/${workspace.slug}/b/${base.id}`} className="flex items-center gap-1.5 flex-1 min-w-0">
                  <Database size={14} style={{ color: base.color }} className="shrink-0" />
                  <span className="truncate text-neutral-800 dark:text-neutral-200 font-medium">{base.name}</span>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 shrink-0"
                      title="Add to this base"
                    >
                      <Plus size={13} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onSelect={() => createTable(base.id)}>
                      <Sheet size={13} /> New table
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => createDashboard(base.id)}>
                      <LayoutDashboard size={13} /> New dashboard
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {expanded.has(base.id) && (
                <div className="ml-5 border-l border-neutral-200 dark:border-neutral-800 pl-2 space-y-0.5 mb-1">
                  {base.tables.map((t) => (
                    <Link
                      key={t.id}
                      href={`/w/${workspace.slug}/b/${base.id}/t/${t.id}`}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2 py-1 truncate",
                        activeTableId === t.id
                          ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium"
                          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      )}
                    >
                      <Sheet size={13} className="shrink-0" />
                      <span className="truncate">{t.name}</span>
                    </Link>
                  ))}
                  {base.dashboards.map((d) => (
                    <Link
                      key={d.id}
                      href={`/w/${workspace.slug}/b/${base.id}/dash/${d.id}`}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2 py-1 truncate",
                        activeDashboardId === d.id
                          ? "bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-medium"
                          : "text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      )}
                    >
                      <LayoutDashboard size={13} className="shrink-0" />
                      <span className="truncate">{d.name}</span>
                    </Link>
                  ))}
                  {base.tables.length === 0 && base.dashboards.length === 0 && (
                    <button onClick={() => createTable(base.id)} className="text-neutral-400 hover:text-neutral-600 px-2 py-1">
                      + Add table
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="mt-3 pt-2 border-t border-neutral-200 dark:border-neutral-800 space-y-0.5">
            <SidebarLink icon={<WorkflowIcon size={14} />} label="Workflows" comingSoon />
            <SidebarLink icon={<BookTemplate size={14} />} label="Templates" comingSoon />
            <SidebarLink icon={<Settings size={14} />} label="Settings" comingSoon />
          </div>
        </nav>

        <div className="border-t border-neutral-200 dark:border-neutral-800 p-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <div className="h-6 w-6 rounded-full bg-indigo-500 flex items-center justify-center text-white text-[11px] font-medium shrink-0">
                  {initials(user.name)}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="truncate text-neutral-800 dark:text-neutral-200 font-medium">{user.name}</div>
                </div>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-52">
              <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={toggle}>
                {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
                {theme === "dark" ? "Light mode" : "Dark mode"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/login" })}>
                <LogOut size={14} /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main content column, top bar rendered per-page (breadcrumb depends on table) */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">{children}</div>

      <Dialog open={newBaseOpen} onOpenChange={setNewBaseOpen}>
        <DialogContent>
          <DialogTitle>New base</DialogTitle>
          <Input autoFocus value={newBaseName} onChange={(e) => setNewBaseName(e.target.value)} placeholder="e.g. HR Operations" onKeyDown={(e) => e.key === "Enter" && createBase()} />
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setNewBaseOpen(false)}>Cancel</Button>
            <Button onClick={createBase}>Create base</Button>
          </div>
        </DialogContent>
      </Dialog>

      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} workspaceId={workspace.id} workspaceSlug={workspace.slug} />
    </div>
  );
}

function SidebarLink({ icon, label, comingSoon }: { icon: React.ReactNode; label: string; comingSoon?: boolean }) {
  return (
    <button
      disabled={comingSoon}
      onClick={() => comingSoon && toast.info(`${label} is planned for a later phase`)}
      className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50"
    >
      {icon}
      <span className="flex-1 text-left">{label}</span>
      {comingSoon && <span className="text-[10px] text-neutral-400">soon</span>}
    </button>
  );
}
