"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Globe2, Info, Lock, Search, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/misc";
import { toast } from "@/components/ui/toast";
import { useT } from "@/components/i18n-provider";
import { api } from "@/lib/api-client";
import { cn, initials } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";
import type { WikiRow } from "@/lib/wiki";

type Role = "viewer" | "editor" | "manager";
interface MemberRow {
  id: string;
  name: string;
  email: string;
  avatarColor: string;
  workspaceRole: string;
  role: Role | null;
  lockedReason: "admin" | "creator" | null;
}

export const WIKI_COLORS = ["#f97316", "#ef4444", "#ec4899", "#8b5cf6", "#6366f1", "#0ea5e9", "#14b8a6", "#22c55e", "#eab308", "#64748b"];

/** Wiki settings + access: who can open it and with which role. Read-only for non-managers. */
export function WikiShareDialog({ wiki, onClose }: { wiki: WikiRow; workspaceId: string; onClose: () => void }) {
  const { t } = useT();
  const router = useRouter();
  const canManage = wiki.myRole === "manager";
  const [name, setName] = useState(wiki.name);
  const [description, setDescription] = useState(wiki.description ?? "");
  const [icon, setIcon] = useState(wiki.icon ?? "");
  const [access, setAccess] = useState(wiki.access);
  const [defaultRole, setDefaultRole] = useState(wiki.defaultRole);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ members: MemberRow[] }>(`/api/wikis/${wiki.id}/members`).then((r) => setMembers(r.members)).catch(() => {});
  }, [wiki.id]);

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return members.filter((m) => !s || m.name.toLowerCase().includes(s) || m.email.toLowerCase().includes(s));
  }, [members, q]);

  function setRole(id: string, role: Role | null) {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, role } : m)));
  }

  function effective(m: MemberRow): string {
    if (m.lockedReason) return t("wikis.role.manager");
    const implied = access === "workspace" ? (m.workspaceRole === "viewer" ? "viewer" : defaultRole) : null;
    const r = m.role ?? implied;
    return r ? t(`wikis.role.${r}` as MessageKey) : t("wikis.noAccess");
  }

  async function save() {
    setSaving(true);
    try {
      await api.patch(`/api/wikis/${wiki.id}`, { name: name.trim(), description: description.trim() || null, icon: icon.trim() || null, access, defaultRole });
      await api.put(`/api/wikis/${wiki.id}/members`, { members: members.filter((m) => m.role && !m.lockedReason).map((m) => ({ userId: m.id, role: m.role })) });
      toast.success(t("common.saved"));
      router.refresh();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(t("wikis.deleteConfirm", { name: wiki.name }))) return;
    try {
      await api.delete(`/api/wikis/${wiki.id}`);
      router.push(`/w/${window.location.pathname.split("/")[2]}/wiki`);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  const label = "text-[11px] font-semibold text-neutral-500 uppercase tracking-wide mb-1 block";
  const managers = members.filter((m) => m.lockedReason || m.role === "manager").map((m) => m.name);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>{canManage ? t("wikis.settingsTitle") : t("wikis.whoHasAccess")}</DialogTitle>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto thin-scroll pr-1" data-testid="wiki-share-dialog">
          {!canManage && (
            <div className="flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/40 px-3 py-2.5 text-xs text-indigo-900 dark:text-indigo-100" data-testid="wiki-share-readonly">
              <Info size={14} className="shrink-0 mt-0.5 text-indigo-600 dark:text-indigo-400" />
              <span>
                {t("wikis.readOnlyNotice", { role: wiki.myRole ? t(`wikis.role.${wiki.myRole}` as MessageKey) : t("wikis.noAccess") })}
                {managers.length > 0 && <> {t("wikis.readOnlyAsk", { names: managers.join(", ") })}</>}
              </span>
            </div>
          )}
          {canManage && (
            <div className="grid gap-3 sm:grid-cols-[1fr_90px]">
              <div>
                <label className={label}>{t("wikis.name")}</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
              </div>
              <div>
                <label className={label}>{t("wikis.icon")}</label>
                <Input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} placeholder="📘" />
              </div>
              <div className="sm:col-span-2">
                <label className={label}>{t("wikis.description")}</label>
                <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
            </div>
          )}

          <div>
            <label className={label}>{t("wikis.access")}</label>
            <div className="grid sm:grid-cols-2 gap-2">
              {(["workspace", "restricted"] as const).map((a) => (
                <button
                  key={a}
                  disabled={!canManage}
                  onClick={() => setAccess(a)}
                  className={cn(
                    "text-left rounded-lg border p-3 flex gap-2.5",
                    access === a ? "border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40" : "border-neutral-200 dark:border-neutral-800",
                    !canManage && "cursor-default",
                    !canManage && access !== a && "opacity-50"
                  )}
                  data-testid={`wiki-access-${a}`}
                >
                  {a === "workspace" ? <Globe2 size={16} className="text-indigo-600 mt-0.5" /> : <Lock size={16} className="text-indigo-600 mt-0.5" />}
                  <span>
                    <span className="block text-sm font-medium">{t(`wikis.access.${a}` as MessageKey)}</span>
                    <span className="block text-xs text-neutral-500">{t(`wikis.access.${a}.hint` as MessageKey)}</span>
                  </span>
                </button>
              ))}
            </div>
            {access === "workspace" && (
              <div className="flex items-center gap-2 mt-2 text-sm">
                <span className="text-neutral-500">{t("wikis.defaultRole")}</span>
                {canManage ? (
                  <Select className="w-40" value={defaultRole} onValueChange={(v) => setDefaultRole(v as "viewer" | "editor")} options={[{ value: "viewer", label: t("wikis.role.viewer") }, { value: "editor", label: t("wikis.role.editor") }]} />
                ) : (
                  <span className="font-medium text-neutral-800 dark:text-neutral-100">{t(`wikis.role.${defaultRole}` as MessageKey)}</span>
                )}
              </div>
            )}
          </div>

          <div>
            <label className={label}>{t("wikis.people")}</label>
            <p className="text-[11px] text-neutral-500 mb-2">{access === "restricted" ? t("wikis.peopleHintRestricted") : t("wikis.peopleHintWorkspace")}</p>
            <div className="relative mb-2">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("vis.search")} className="pl-8" />
            </div>
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800">
              {shown.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid="wiki-member">
                  <span className="h-7 w-7 rounded-full text-white text-[10px] font-semibold flex items-center justify-center shrink-0" style={{ backgroundColor: m.avatarColor }}>
                    {initials(m.name)}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium">{m.name}</span>
                    <span className="block truncate text-xs text-neutral-400">{m.email}</span>
                  </span>
                  {m.lockedReason ? (
                    <span className="text-xs text-neutral-400">{t(`wikis.locked.${m.lockedReason}` as MessageKey)}</span>
                  ) : canManage ? (
                    <Select
                      className="w-40"
                      value={m.role ?? ""}
                      onValueChange={(v) => setRole(m.id, (v || null) as Role | null)}
                      options={[
                        { value: "", label: access === "workspace" ? t("wikis.role.default") : t("wikis.noAccess") },
                        { value: "viewer", label: t("wikis.role.viewer") },
                        { value: "editor", label: t("wikis.role.editor") },
                        { value: "manager", label: t("wikis.role.manager") },
                      ]}
                      data-testid={`wiki-role-${m.email}`}
                    />
                  ) : null}
                  <span className="w-24 text-right text-xs text-neutral-500 shrink-0">{effective(m)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-4">
          {canManage && (
            <Button variant="ghost" className="text-red-600" onClick={remove}>
              <Trash2 size={13} /> {t("wikis.delete")}
            </Button>
          )}
          <div className="ml-auto flex gap-2">
            <Button variant="secondary" onClick={onClose}>{canManage ? t("common.cancel") : t("common.close")}</Button>
            {canManage && (
              <Button onClick={save} disabled={saving || !name.trim()} data-testid="wiki-share-save">
                {t("common.save")}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
