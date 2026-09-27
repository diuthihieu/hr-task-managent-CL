"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { ShieldCheck, UserPlus, Plus, Copy, ArrowLeft, MoreHorizontal, KeyRound, UserX, UserCheck, Trash2, Crown } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, Badge } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { formatDate, cn } from "@/lib/utils";
import type { AdminUserRow } from "@/types";
import { DesktopReleasesPanel } from "./desktop-releases-panel";
import { useT } from "@/components/i18n-provider";

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
}

const ROLE_OPTIONS = ["owner", "admin", "editor", "contributor", "viewer"].map((r) => ({ value: r, label: r }));

export function AdminConsole({ currentUserId }: { currentUserId: string }) {
  const { t: tr } = useT();
  const [tab, setTab] = useState<"users" | "workspaces" | "desktop">("users");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [u, w] = await Promise.all([api.get<AdminUserRow[]>("/api/admin/users"), api.get<WorkspaceItem[]>("/api/workspaces")]);
      setUsers(u);
      setWorkspaces(w);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("common.failed"));
    } finally {
      setLoading(false);
    }
  }, [tr]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    load();
  }, [load]);

  async function patchUser(user: AdminUserRow, body: Record<string, unknown>, success: string) {
    try {
      const res = await api.patch<{ temporaryPassword?: string }>(`/api/admin/users/${user.id}`, body);
      if (res.temporaryPassword) setSecret({ email: user.email, password: res.temporaryPassword });
      toast.success(success);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("common.failed"));
    }
  }

  async function deleteUser(user: AdminUserRow) {
    if (!confirm(tr("adm.deleteConfirm", { email: user.email }))) return;
    try {
      await api.delete(`/api/admin/users/${user.id}`);
      toast.success(tr("adm.deleted"));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("common.failed"));
    }
  }

  async function createWorkspace() {
    const name = prompt(tr("adm.wsName"));
    if (!name?.trim()) return;
    try {
      await api.post("/api/workspaces", { name: name.trim() });
      toast.success(tr("ws.created"));
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("common.failed"));
    }
  }

  async function deleteWorkspace(w: WorkspaceItem) {
    if (!confirm(tr("adm.wsDeleteConfirm", { name: w.name }))) return;
    try {
      await api.delete(`/api/workspaces/${w.id}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr("common.failed"));
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-sm">
      <header className="h-12 flex items-center gap-3 px-6 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <Link href="/workspaces" className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" title={tr("adm.back")}>
          <ArrowLeft size={16} />
        </Link>
        <ShieldCheck size={16} className="text-indigo-600" />
        <span className="font-semibold text-neutral-900 dark:text-neutral-50">{tr("adm.title")}</span>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/account/password" className="text-neutral-500 hover:underline">{tr("nav.changePassword")}</Link>
          <button onClick={() => signOut({ callbackUrl: "/" })} className="text-neutral-500 hover:underline">{tr("auth.signOut")}</button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center gap-1 mb-4 border-b border-neutral-200 dark:border-neutral-800">
          {(["users", "workspaces", "desktop"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("px-3 py-2 -mb-px border-b-2", tab === t ? "border-indigo-600 text-indigo-700 dark:text-indigo-300 font-medium" : "border-transparent text-neutral-500")}
            >
              {t === "desktop" ? tr("adm.desktop") : t === "users" ? tr("adm.users", { count: users.length }) : tr("adm.workspaces", { count: workspaces.length })}
            </button>
          ))}
          <div className="ml-auto pb-1.5">
            {tab === "users" ? (
              <Button onClick={() => setCreateOpen(true)}>
                <UserPlus size={14} /> {tr("adm.createAccount")}
              </Button>
            ) : tab === "desktop" ? null : (
              <Button onClick={createWorkspace}>
                <Plus size={14} /> {tr("ws.new")}
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-neutral-400 py-10 text-center">{tr("common.loading")}</div>
        ) : tab === "desktop" ? (
          <DesktopReleasesPanel />
        ) : tab === "users" ? (
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-x-auto">
            <table className="w-full">
              <thead className="text-xs text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
                <tr>
                  <th className="text-left font-medium px-4 py-2">{tr("adm.user")}</th>
                  <th className="text-left font-medium px-4 py-2">{tr("adm.systemRole")}</th>
                  <th className="text-left font-medium px-4 py-2">{tr("adm.status")}</th>
                  <th className="text-left font-medium px-4 py-2">Workspace</th>
                  <th className="text-left font-medium px-4 py-2">{tr("adm.lastSignIn")}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className={cn("border-b last:border-0 border-neutral-100 dark:border-neutral-800", !u.isActive && "opacity-60")}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-neutral-900 dark:text-neutral-100">{u.name}{u.id === currentUserId && <span className="text-neutral-400 font-normal"> (you)</span>}</div>
                      <div className="text-xs text-neutral-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-2">
                      {u.systemRole === "ADMIN" ? <Badge className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{tr("adm.admin")}</Badge> : <span className="text-neutral-500">{tr("adm.member")}</span>}
                    </td>
                    <td className="px-4 py-2">
                      {!u.isActive ? (
                        <Badge className="bg-neutral-100 text-neutral-600 dark:bg-neutral-800">{tr("adm.deactivated")}</Badge>
                      ) : u.mustChangePassword ? (
                        <Badge className="bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">{tr("adm.pending")}</Badge>
                      ) : (
                        <Badge className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">{tr("adm.active")}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-neutral-600 dark:text-neutral-400">
                      {u.workspaces.length ? u.workspaces.map((w) => `${w.name} (${w.role})`).join(", ") : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-neutral-500">{u.lastLoginAt ? formatDate(u.lastLoginAt, true) : tr("adm.never")}</td>
                    <td className="px-2 py-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1 rounded text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={`Actions for ${u.email}`}>
                            <MoreHorizontal size={15} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => confirm(tr("adm.resetConfirm", { email: u.email })) && patchUser(u, { resetPassword: true }, tr("adm.resetDone"))}>
                            <KeyRound size={13} /> {tr("adm.reset")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => patchUser(u, { systemRole: u.systemRole === "ADMIN" ? "MEMBER" : "ADMIN" }, tr("adm.roleUpdated"))}>
                            <Crown size={13} /> {u.systemRole === "ADMIN" ? tr("adm.removeAdmin") : tr("adm.makeAdmin")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => patchUser(u, { isActive: !u.isActive }, u.isActive ? tr("adm.deactivatedToast") : tr("adm.reactivatedToast"))} disabled={u.id === currentUserId}>
                            {u.isActive ? <UserX size={13} /> : <UserCheck size={13} />} {u.isActive ? tr("adm.deactivate") : tr("adm.reactivate")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => deleteUser(u)} disabled={u.id === currentUserId} className="text-red-600 dark:text-red-400">
                            <Trash2 size={13} /> {tr("adm.deleteAccount")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {workspaces.length === 0 && <div className="text-neutral-400 py-10">{tr("adm.noWorkspaces")}</div>}
            {workspaces.map((w) => (
              <div key={w.id} className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-neutral-900 dark:text-neutral-100 truncate">{w.name}</div>
                  <div className="text-xs text-neutral-500">{users.filter((u) => u.workspaces.some((x) => x.id === w.id)).length} members</div>
                </div>
                <Link href={`/w/${w.slug}`} className="text-indigo-600 hover:underline">{tr("common.open")}</Link>
                <Link href={`/w/${w.slug}/settings`} className="text-neutral-500 hover:underline">{tr("nav.settings")}</Link>
                <button onClick={() => deleteWorkspace(w)} className="text-neutral-400 hover:text-red-600" aria-label={`Delete ${w.name}`}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        workspaces={workspaces}
        onCreated={(email, password) => {
          setCreateOpen(false);
          if (password) setSecret({ email, password });
          load();
        }}
      />

      <Dialog open={!!secret} onOpenChange={(v) => !v && setSecret(null)}>
        <DialogContent>
          <DialogTitle>{tr("adm.tempPassword")}</DialogTitle>
          <p className="text-sm text-neutral-500">
            {tr("adm.tempShare", { email: secret?.email ?? "" })}
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 py-2 font-mono">
            <span className="flex-1 select-all" data-testid="temp-password">{secret?.password}</span>
            <button
              onClick={() => navigator.clipboard.writeText(secret?.password ?? "").then(() => toast.success(tr("adm.copied")))}
              className="text-neutral-400 hover:text-neutral-700"
              aria-label={tr("adm.copyPassword")}
            >
              <Copy size={14} />
            </button>
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={() => setSecret(null)}>{tr("common.done")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  workspaces,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  workspaces: WorkspaceItem[];
  onCreated: (email: string, temporaryPassword?: string) => void;
}) {
  const { t: tr } = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [systemRole, setSystemRole] = useState("MEMBER");
  const [workspaceId, setWorkspaceId] = useState("none");
  const [workspaceRole, setWorkspaceRole] = useState("editor");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api.post<{ email: string; temporaryPassword?: string }>("/api/admin/users", {
        name,
        email,
        systemRole,
        ...(workspaceId !== "none" ? { workspaceId, workspaceRole } : {}),
      });
      setName("");
      setEmail("");
      setSystemRole("MEMBER");
      setWorkspaceId("none");
      onCreated(res.email, res.temporaryPassword);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>{tr("adm.createAccount")}</DialogTitle>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="new-name" className="text-xs font-medium text-neutral-500 mb-1 block">{tr("auth.fullName")}</label>
            <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div>
            <label htmlFor="new-email" className="text-xs font-medium text-neutral-500 mb-1 block">Email</label>
            <Input id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">{tr("adm.systemRole")}</label>
            <Select className="w-full" value={systemRole} onValueChange={setSystemRole} options={[{ value: "MEMBER", label: tr("adm.member") }, { value: "ADMIN", label: tr("adm.adminRole") }]} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{tr("adm.addToWs")}</label>
              <Select className="w-full" value={workspaceId} onValueChange={setWorkspaceId} options={[{ value: "none", label: tr("adm.notNow") }, ...workspaces.map((w) => ({ value: w.id, label: w.name }))]} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{tr("adm.wsRole")}</label>
              <Select className="w-full" value={workspaceRole} onValueChange={setWorkspaceRole} options={ROLE_OPTIONS} />
            </div>
          </div>
          <p className="text-[11px] text-neutral-400">{tr("adm.tempHint")}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>{tr("common.cancel")}</Button>
            <Button type="submit" disabled={saving}>{saving ? tr("adm.creating") : tr("adm.createAccount")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
