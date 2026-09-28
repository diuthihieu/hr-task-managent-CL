"use client";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { LayoutGrid, Plus, Building2, LogOut, Palette, KeyRound, ShieldCheck, MoreHorizontal, DoorOpen, MonitorDown, ChevronRight } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuLabel } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { LocaleSwitch } from "@/components/landing/locale-switch";
import { PreferencesDialog } from "@/components/preferences/preferences-dialog";
import { useDesktopVersion } from "@/components/desktop/use-desktop";
import { api } from "@/lib/api-client";
import { initials } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";

export interface WorkspaceCard {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  role: string;
  projects: number;
  members: number;
}

export function WorkspaceChooser({ user, workspaces }: { user: { id: string; name: string; email: string; avatarColor: string; isAdmin: boolean }; workspaces: WorkspaceCard[] }) {
  const { t } = useT();
  const router = useRouter();
  const desktopVersion = useDesktopVersion();
  const [createOpen, setCreateOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const ws = await api.post<{ slug: string }>("/api/workspaces", { name: name.trim(), description: description.trim() || null });
      toast.success(t("ws.created"));
      router.push(`/w/${ws.slug}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      setBusy(false);
    }
  }

  async function leave(w: WorkspaceCard) {
    if (!confirm(t("ws.leaveConfirm", { name: w.name }))) return;
    try {
      await api.delete(`/api/workspaces/${w.id}/members/${user.id}`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="h-14 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="max-w-5xl mx-auto h-full px-4 flex items-center gap-3">
          <span className="h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
            <LayoutGrid size={17} />
          </span>
          <span className="font-semibold text-neutral-900 dark:text-neutral-50">Basework</span>
          <div className="ml-auto flex items-center gap-2">
            <LocaleSwitch signedIn />
            <NotificationBell align="end" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" data-testid="user-menu">
                  <span className="h-7 w-7 rounded-full text-white text-xs flex items-center justify-center" style={{ backgroundColor: user.avatarColor }}>
                    {initials(user.name)}
                  </span>
                  <span className="hidden sm:inline text-sm text-neutral-700 dark:text-neutral-200">{user.name}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end">
                <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => setPrefsOpen(true)}>
                  <Palette size={14} /> {t("nav.preferences")}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => router.push("/account/password")}>
                  <KeyRound size={14} /> {t("nav.changePassword")}
                </DropdownMenuItem>
                {user.isAdmin && (
                  <DropdownMenuItem onSelect={() => router.push("/admin")}>
                    <ShieldCheck size={14} /> {t("nav.adminConsole")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/" })}>
                  <LogOut size={14} /> {t("auth.signOut")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-50">{t("ws.title")}</h1>
            <p className="text-sm text-neutral-500 mt-1">{t("ws.subtitle")}</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="new-workspace">
            <Plus size={15} /> {t("ws.new")}
          </Button>
        </div>

        {workspaces.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 p-10 text-center">
            <Building2 size={36} className="mx-auto text-indigo-500 mb-3" />
            <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">{t("ws.empty.title")}</h2>
            <p className="text-sm text-neutral-500 mt-1 max-w-md mx-auto">{t("ws.empty.body", { email: user.email })}</p>
            <Button className="mt-5" onClick={() => setCreateOpen(true)}>
              <Plus size={15} /> {t("ws.new")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((w) => (
              <div key={w.id} className="group relative rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-800 transition-all">
                <Link href={`/w/${w.slug}`} className="block p-5" data-testid={`workspace-card-${w.slug}`}>
                  <div className="flex items-center gap-3">
                    <span className="h-10 w-10 rounded-lg bg-indigo-600 text-white font-semibold flex items-center justify-center">{initials(w.name)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">{w.name}</div>
                      <div className="text-xs text-neutral-500">{t(`role.${w.role}` as MessageKey)}</div>
                    </div>
                    <ChevronRight size={16} className="text-neutral-300 group-hover:text-indigo-500" />
                  </div>
                  {w.description && <p className="text-sm text-neutral-500 mt-3 line-clamp-2">{w.description}</p>}
                  <p className="text-xs text-neutral-400 mt-3">{t("ws.stats", { projects: w.projects, members: w.members })}</p>
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="absolute right-3 bottom-3 opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" aria-label={t("common.more")}>
                      <MoreHorizontal size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => leave(w)} className="text-red-600 dark:text-red-400">
                      <DoorOpen size={14} /> {t("ws.leave")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}

        {!desktopVersion && (
          <Link href="/download" className="mt-10 inline-flex items-center gap-2 text-sm text-indigo-600 hover:underline">
            <MonitorDown size={15} /> {t("nav.download")}
          </Link>
        )}
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogTitle>{t("ws.new")}</DialogTitle>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block" htmlFor="ws-name">{t("ws.name")}</label>
              <Input id="ws-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ws.namePlaceholder")} onKeyDown={(e) => e.key === "Enter" && create()} maxLength={120} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block" htmlFor="ws-desc">
                {t("ws.description")} <span className="font-normal">({t("common.optional")})</span>
              </label>
              <Textarea id="ws-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={create} disabled={!name.trim() || busy} data-testid="create-workspace">{t("common.create")}</Button>
          </div>
        </DialogContent>
      </Dialog>
      <PreferencesDialog open={prefsOpen} onOpenChange={setPrefsOpen} />
    </div>
  );
}
