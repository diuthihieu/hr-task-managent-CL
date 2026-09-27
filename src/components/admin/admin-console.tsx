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

interface WorkspaceItem {
  id: string;
  name: string;
  slug: string;
}

const ROLE_OPTIONS = ["owner", "admin", "editor", "contributor", "viewer"].map((r) => ({ value: r, label: r }));

export function AdminConsole({ currentUserId }: { currentUserId: string }) {
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
      toast.error(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

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
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function deleteUser(user: AdminUserRow) {
    if (!confirm(`Delete ${user.email}? They lose access immediately; their past activity stays in the audit log.`)) return;
    try {
      await api.delete(`/api/admin/users/${user.id}`);
      toast.success("Account deleted");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function createWorkspace() {
    const name = prompt("New workspace name");
    if (!name?.trim()) return;
    try {
      await api.post("/api/workspaces", { name: name.trim() });
      toast.success("Workspace created");
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create workspace");
    }
  }

  async function deleteWorkspace(w: WorkspaceItem) {
    if (!confirm(`Delete workspace "${w.name}"? It disappears for every member (soft delete - data stays in the database).`)) return;
    try {
      await api.delete(`/api/workspaces/${w.id}`);
      load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete workspace");
    }
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 text-sm">
      <header className="h-12 flex items-center gap-3 px-6 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <Link href="/" className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" title="Back to app">
          <ArrowLeft size={16} />
        </Link>
        <ShieldCheck size={16} className="text-indigo-600" />
        <span className="font-semibold text-neutral-900 dark:text-neutral-50">Admin console</span>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/account/password" className="text-neutral-500 hover:underline">Change password</Link>
          <button onClick={() => signOut({ callbackUrl: "/login" })} className="text-neutral-500 hover:underline">Sign out</button>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-6">
        <div className="flex items-center gap-1 mb-4 border-b border-neutral-200 dark:border-neutral-800">
          {(["users", "workspaces", "desktop"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("px-3 py-2 -mb-px border-b-2 capitalize", tab === t ? "border-indigo-600 text-indigo-700 dark:text-indigo-300 font-medium" : "border-transparent text-neutral-500")}
            >
              {t === "desktop" ? "Desktop releases" : `${t} (${t === "users" ? users.length : workspaces.length})`}
            </button>
          ))}
          <div className="ml-auto pb-1.5">
            {tab === "users" ? (
              <Button onClick={() => setCreateOpen(true)}>
                <UserPlus size={14} /> Create account
              </Button>
            ) : tab === "desktop" ? null : (
              <Button onClick={createWorkspace}>
                <Plus size={14} /> New workspace
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-neutral-400 py-10 text-center">Loading…</div>
        ) : tab === "desktop" ? (
          <DesktopReleasesPanel />
        ) : tab === "users" ? (
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-x-auto">
            <table className="w-full">
              <thead className="text-xs text-neutral-500 border-b border-neutral-200 dark:border-neutral-800">
                <tr>
                  <th className="text-left font-medium px-4 py-2">User</th>
                  <th className="text-left font-medium px-4 py-2">System role</th>
                  <th className="text-left font-medium px-4 py-2">Status</th>
                  <th className="text-left font-medium px-4 py-2">Workspaces</th>
                  <th className="text-left font-medium px-4 py-2">Last sign-in</th>
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
                      {u.systemRole === "ADMIN" ? <Badge className="bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">Admin</Badge> : <span className="text-neutral-500">Member</span>}
                    </td>
                    <td className="px-4 py-2">
                      {!u.isActive ? (
                        <Badge className="bg-neutral-100 text-neutral-600 dark:bg-neutral-800">Deactivated</Badge>
                      ) : u.mustChangePassword ? (
                        <Badge className="bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300">Pending first sign-in</Badge>
                      ) : (
                        <Badge className="bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300">Active</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-neutral-600 dark:text-neutral-400">
                      {u.workspaces.length ? u.workspaces.map((w) => `${w.name} (${w.role})`).join(", ") : <span className="text-neutral-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-xs text-neutral-500">{u.lastLoginAt ? formatDate(u.lastLoginAt, true) : "Never"}</td>
                    <td className="px-2 py-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button className="p-1 rounded text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800" aria-label={`Actions for ${u.email}`}>
                            <MoreHorizontal size={15} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent>
                          <DropdownMenuItem onSelect={() => confirm(`Reset password for ${u.email}? A new temporary password will be shown once.`) && patchUser(u, { resetPassword: true }, "Password reset")}>
                            <KeyRound size={13} /> Reset password
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => patchUser(u, { systemRole: u.systemRole === "ADMIN" ? "MEMBER" : "ADMIN" }, "Role updated")}>
                            <Crown size={13} /> {u.systemRole === "ADMIN" ? "Remove admin" : "Make admin"}
                          </DropdownMenuItem>
                          <DropdownMenuItem onSelect={() => patchUser(u, { isActive: !u.isActive }, u.isActive ? "Account deactivated" : "Account reactivated")} disabled={u.id === currentUserId}>
                            {u.isActive ? <UserX size={13} /> : <UserCheck size={13} />} {u.isActive ? "Deactivate" : "Reactivate"}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => deleteUser(u)} disabled={u.id === currentUserId} className="text-red-600 dark:text-red-400">
                            <Trash2 size={13} /> Delete account
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
            {workspaces.length === 0 && <div className="text-neutral-400 py-10">No workspaces yet. Create the first one.</div>}
            {workspaces.map((w) => (
              <div key={w.id} className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-neutral-900 dark:text-neutral-100 truncate">{w.name}</div>
                  <div className="text-xs text-neutral-500">{users.filter((u) => u.workspaces.some((x) => x.id === w.id)).length} members</div>
                </div>
                <Link href={`/w/${w.slug}`} className="text-indigo-600 hover:underline">Open</Link>
                <Link href={`/w/${w.slug}/settings`} className="text-neutral-500 hover:underline">Settings</Link>
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
          <DialogTitle>Temporary password</DialogTitle>
          <p className="text-sm text-neutral-500">
            Share this with <b>{secret?.email}</b> through a private channel. It is shown only once; they must change it at first sign-in.
          </p>
          <div className="mt-3 flex items-center gap-2 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 py-2 font-mono">
            <span className="flex-1 select-all" data-testid="temp-password">{secret?.password}</span>
            <button
              onClick={() => navigator.clipboard.writeText(secret?.password ?? "").then(() => toast.success("Copied"))}
              className="text-neutral-400 hover:text-neutral-700"
              aria-label="Copy password"
            >
              <Copy size={14} />
            </button>
          </div>
          <div className="flex justify-end mt-4">
            <Button onClick={() => setSecret(null)}>Done</Button>
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
      toast.error(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>Create account</DialogTitle>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="new-name" className="text-xs font-medium text-neutral-500 mb-1 block">Full name</label>
            <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </div>
          <div>
            <label htmlFor="new-email" className="text-xs font-medium text-neutral-500 mb-1 block">Email</label>
            <Input id="new-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-500 mb-1 block">System role</label>
            <Select className="w-full" value={systemRole} onValueChange={setSystemRole} options={[{ value: "MEMBER", label: "Member" }, { value: "ADMIN", label: "Admin (manages accounts & workspaces)" }]} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Add to workspace</label>
              <Select className="w-full" value={workspaceId} onValueChange={setWorkspaceId} options={[{ value: "none", label: "Not now" }, ...workspaces.map((w) => ({ value: w.id, label: w.name }))]} />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Workspace role</label>
              <Select className="w-full" value={workspaceRole} onValueChange={setWorkspaceRole} options={ROLE_OPTIONS} />
            </div>
          </div>
          <p className="text-[11px] text-neutral-400">A temporary password is generated and shown once. The user must change it at first sign-in.</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create account"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
