"use client";
import { useEffect, useState } from "react";
import { UserPlus, Trash2, Copy, Mail, Clock, Check, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/misc";
import { InviteDialog } from "@/components/invitations/invite-dialog";
import { initials } from "@/lib/utils";
import { SettingsSection } from "./settings-shell";
import { useT } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/core";
import { AvatarImg } from "@/components/ui/avatar-img";
import { Meta, MetaChip } from "@/components/ui/meta";

interface MemberRow {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  role: string;
  isActive?: boolean;
}

interface PendingInvite {
  id: string;
  email: string;
  role: string;
  url: string;
  expiresAt: string;
  expired: boolean;
  hasAccount: boolean;
  invitedBy: string | null;
}

const ROLE_KEYS = ["owner", "admin", "editor", "contributor", "viewer"] as const;

export function SettingsMembers({ workspaceId, currentUserId, currentUserRole }: { workspaceId: string; currentUserId: string; currentUserRole: string; isSystemAdmin?: boolean }) {
  const { t } = useT();
  const ROLES = ROLE_KEYS.map((r) => ({ value: r, label: t(`role.${r}`) }));
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const canManage = ["owner", "admin"].includes(currentUserRole);

  function load() {
    api
      .get<MemberRow[]>(`/api/workspaces/${workspaceId}/members?withRoles=1`)
      .then(setMembers)
      .finally(() => setLoading(false));
    if (canManage) api.get<PendingInvite[]>(`/api/workspaces/${workspaceId}/invitations`).then(setPending).catch(() => {});
  }

  async function revoke(inv: PendingInvite) {
    if (!confirm(t("inv.revokeConfirm", { email: inv.email }))) return;
    try {
      await api.delete(`/api/invitations/${inv.id}`);
      setPending((prev) => prev.filter((x) => x.id !== inv.id));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("inv.copied"));
    } catch {
      window.prompt(t("inv.copyManually"), url);
    }
  }

  useEffect(load, [workspaceId, canManage]);

  // Role changes are staged: nothing changes until the admin presses Confirm.
  const [staged, setStaged] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const roleLabel = (r: string) => t(`role.${r}` as MessageKey);
  const unstage = (id: string) =>
    setStaged((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });

  async function confirmRole(m: MemberRow) {
    const role = staged[m.id];
    if (!role || role === m.role) return;
    if (!confirm(t("mem.confirmPrompt", { name: m.name, from: roleLabel(m.role), to: roleLabel(role) }))) return;
    setSaving(m.id);
    try {
      await api.patch(`/api/workspaces/${workspaceId}/members/${m.id}`, { role });
      setMembers((prev) => prev.map((x) => (x.id === m.id ? { ...x, role } : x)));
      unstage(m.id);
      toast.success(t("mem.changed", { name: m.name }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      load();
    } finally {
      setSaving(null);
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

  return (
    <SettingsSection
      title={t("set.members")}
      description={t("set.membersDesc")}
      action={
        canManage && (
          <Button size="sm" onClick={() => setInviteOpen(true)}>
            <UserPlus size={13} /> {t("inv.invite")}
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
              <div className="relative overflow-hidden h-8 w-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0" style={{ backgroundColor: m.avatarColor }}>
                {initials(m.name)}
                <AvatarImg id={m.id} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate">
                  {m.name} {m.id === currentUserId && <span className="text-neutral-400 font-normal">{t("set.you")}</span>}
                  {m.isActive === false && <span className="ml-1 text-[10px] uppercase text-neutral-400">{t("set.deactivated")}</span>}
                </div>
                <div className="text-xs text-neutral-400 truncate">{m.email}</div>
              </div>
              {canManage ? (
                <div className="flex items-center gap-1.5 shrink-0">
                  {staged[m.id] && staged[m.id] !== m.role && (
                    <>
                      <span className="hidden sm:inline text-[11px] text-amber-600" data-testid="role-pending">{t("mem.pendingChange", { from: roleLabel(m.role), to: roleLabel(staged[m.id]) })}</span>
                      <Button size="sm" className="h-7 px-2 text-xs" disabled={saving === m.id} onClick={() => confirmRole(m)} data-testid="role-confirm">
                        <Check size={12} /> {t("mem.confirmChange")}
                      </Button>
                      <button onClick={() => unstage(m.id)} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200" title={t("mem.cancelChange")} aria-label={t("mem.cancelChange")} data-testid="role-cancel">
                        <X size={14} />
                      </button>
                    </>
                  )}
                  <Select
                    className="w-32"
                    value={staged[m.id] ?? m.role}
                    onValueChange={(v) => setStaged((prev) => ({ ...prev, [m.id]: v }))}
                    options={currentUserRole === "owner" ? ROLES : ROLES.filter((r) => r.value !== "owner" || m.role === "owner")}
                    data-testid="member-role"
                  />
                </div>
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
      {canManage && Object.entries(staged).some(([id, r]) => members.find((m) => m.id === id)?.role !== r) && <p className="text-xs text-amber-600 mt-2 max-w-2xl">{t("mem.unsaved")}</p>}

      {canManage && pending.length > 0 && (
        <div className="max-w-2xl mt-6" data-testid="pending-invites">
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100 mb-2 flex items-center gap-1.5">
            <Clock size={14} className="text-indigo-600" /> {t("inv.pending")} <span className="text-neutral-400 font-normal">{pending.length}</span>
          </h3>
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-lg divide-y divide-neutral-100 dark:divide-neutral-900">
            {pending.map((p) => (
              <div key={p.id} className="flex items-center gap-3 px-3 py-2.5" data-testid="pending-invite">
                <span className="h-8 w-8 rounded-full flex items-center justify-center bg-neutral-100 dark:bg-neutral-800 text-neutral-500 shrink-0">
                  <Mail size={14} />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-neutral-800 dark:text-neutral-100 truncate">{p.email}</div>
                  <div className="text-xs text-neutral-400 truncate">
                    <Meta><MetaChip>{t(`role.${p.role}` as MessageKey)}</MetaChip><span>{p.expired ? t("inv.expired") : p.hasAccount ? t("inv.waiting") : t("inv.waitingSignup")}</span></Meta>
                  </div>
                </div>
                <button onClick={() => copyLink(p.url)} className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:underline shrink-0">
                  <Copy size={12} /> {t("inv.copyLink")}
                </button>
                <button onClick={() => revoke(p)} className="text-neutral-400 hover:text-red-600 shrink-0" title={t("inv.revoke")} aria-label={t("inv.revoke")}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} workspaceId={workspaceId} onInvited={load} />
    </SettingsSection>
  );
}
