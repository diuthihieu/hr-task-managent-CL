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
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";

interface MemberRow {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  role: string;
  isActive?: boolean;
}

const ROLE_KEYS = ["owner", "admin", "editor", "contributor", "viewer"] as const;

export function SettingsMembers({ workspaceId, currentUserId, currentUserRole }: { workspaceId: string; currentUserId: string; currentUserRole: string; isSystemAdmin?: boolean }) {
  const { t } = useT();
  const ROLES = ROLE_KEYS.map((r) => ({ value: r, label: t(`role.${r}`) }));
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
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      load();
    }
  }

  async function removeMember(userId: string, name: string) {
    if (!confirm(t("set.removeMember", { name }))) return;
    try {
      await api.delete(`/api/workspaces/${workspaceId}/members/${userId}`);
      setMembers((prev) => prev.filter((m) => m.id !== userId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function invite() {
    try {
      const member = await api.post<MemberRow>(`/api/workspaces/${workspaceId}/members`, { email, role: inviteRole });
      setMembers((prev) => [...prev, member]);
      setInviteOpen(false);
      setEmail("");
      toast.success(t("set.memberAdded", { name: member.name }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  return (
    <SettingsSection
      title={t("set.members")}
      description={t("set.membersDesc")}
      action={
        canManage && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus size={13} /> {t("set.addMember")}
          </Button>
        )
      }
    >
      {loading ? (
        <p className="text-sm text-neutral-400">{t("common.loading")}</p>
      ) : (
        <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-100 dark:divide-neutral-900 max-w-2xl">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0" style={{ backgroundColor: m.avatarColor }}>
                {initials(m.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate">
                  {m.name} {m.id === currentUserId && <span className="text-neutral-400 font-normal">{t("set.you")}</span>}
                  {m.isActive === false && <span className="ml-1 text-[10px] uppercase text-neutral-400">{t("set.deactivated")}</span>}
                </div>
                <div className="text-xs text-neutral-400 truncate">{m.email}</div>
              </div>
              {canManage ? (
                <Select className="w-32" value={m.role} onValueChange={(v) => changeRole(m.id, v)} options={currentUserRole === "owner" ? ROLES : ROLES.filter((r) => r.value !== "owner" || m.role === "owner")} />
              ) : (
                <span className="text-xs text-neutral-500 w-32 text-right">{t(`role.${m.role}` as MessageKey)}</span>
              )}
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
          <DialogTitle>{t("set.addMember")}</DialogTitle>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("common.email")}</label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" autoFocus />
              <p className="text-[11px] text-neutral-400 mt-1">{t("set.addMemberHint")}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-500 mb-1 block">{t("common.role")}</label>
              <Select className="w-full" value={inviteRole} onValueChange={setInviteRole} options={currentUserRole === "owner" ? ROLES : ROLES.filter((r) => r.value !== "owner")} />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="secondary" onClick={() => setInviteOpen(false)}>{t("common.cancel")}</Button>
            <Button onClick={invite} disabled={!email.trim()} data-testid="add-member-submit">{t("set.addMember")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}
