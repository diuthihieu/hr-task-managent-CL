"use client";
import { useEffect, useState } from "react";
import { UserPlus, Trash2 } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/misc";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { initials } from "@/lib/utils";
import { SettingsSection } from "./settings-shell";

interface MemberRow {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  role: string;
}

const ROLES = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "editor", label: "Editor" },
  { value: "contributor", label: "Contributor" },
  { value: "viewer", label: "Viewer" },
];

export function SettingsMembers({ workspaceId, currentUserId, currentUserRole }: { workspaceId: string; currentUserId: string; currentUserRole: string }) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("editor");
  const canManage = ["owner", "admin"].includes(currentUserRole);

  function load() {
    api
      .get<MemberRow[]>(`/api/workspaces/${workspaceId}/members?withRoles=1`)
      .then(setMembers)
      .finally(() => setLoading(false));
  }

  useEffect(load, [workspaceId]);

  async function changeRole(userId: string, role: string) {
    setMembers((prev) => prev.map((m) => (m.id === userId ? { ...m, role } : m)));
    try {
      await api.patch(`/api/workspaces/${workspaceId}/members/${userId}`, { role });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update role");
      load();
    }
  }

  async function removeMember(userId: string, name: string) {
    if (!confirm(`Remove ${name} from this workspace?`)) return;
    try {
      await api.delete(`/api/workspaces/${workspaceId}/members/${userId}`);
      setMembers((prev) => prev.filter((m) => m.id !== userId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove member");
    }
  }

  async function invite() {
    try {
      const member = await api.post<MemberRow>(`/api/workspaces/${workspaceId}/members`, { email, role: inviteRole });
      setMembers((prev) => [...prev, member]);
      setInviteOpen(false);
      setEmail("");
      toast.success(`${member.name} added to the workspace`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add member");
    }
  }

  return (
    <SettingsSection
      title="Members & Roles"
      description="Manage who has access to this workspace and what they can do."
      action={
        canManage && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus size={13} /> Add member
          </Button>
        )
      }
    >
      {loading ? (
        <p className="text-sm text-neutral-400">Loading…</p>
      ) : (
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-100 dark:divide-neutral-900 max-w-2xl">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0" style={{ backgroundColor: m.avatarColor }}>
                {initials(m.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate">
                  {m.name} {m.id === currentUserId && <span className="text-neutral-400 font-normal">(you)</span>}
                </div>
                <div className="text-xs text-neutral-400 truncate">{m.email}</div>
              </div>
              <Select
                className="w-32"
                value={m.role}
                onValueChange={(v) => changeRole(m.id, v)}
                options={ROLES}
              />
              {canManage && m.id !== currentUserId && (
                <button onClick={() => removeMember(m.id, m.name)} className="text-neutral-400 hover:text-red-600 shrink-0">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogTitle>Add member</DialogTitle>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Email</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoFocus />
              <p className="text-[11px] text-neutral-400 mt-1">The person must already have an account in this app.</p>
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">Role</label>
              <Select className="w-full" value={inviteRole} onValueChange={setInviteRole} options={ROLES.filter((r) => r.value !== "owner")} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>Cancel</Button>
            <Button onClick={invite} disabled={!email.trim()}>Add member</Button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
