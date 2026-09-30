"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Inbox, ExternalLink, Check, CheckCircle2, AlarmClockOff, Clock, Eye, UserCheck, ThumbsUp, ThumbsDown, Sparkles } from "lucide-react";
import { useT } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { toast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import { cn, initials } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/core";
import { describeNotification, fetchInbox, markAllRead, notificationTitle, timeAgo, type NotificationItem } from "./notification-bell";
import { AvatarImg } from "@/components/ui/avatar-img";
import { Meta, MetaChip, MetaItem } from "@/components/ui/meta";
import { Clock3 } from "lucide-react";

type View = "todo" | "all" | "snoozed";
const GROUPS: { key: string; types: string[] }[] = [
  { key: "all", types: [] },
  { key: "assigned", types: ["task_assigned", "task_report_added"] },
  { key: "mention", types: ["mention"] },
  { key: "due", types: ["task_due_soon", "task_overdue", "task_due_changed", "capture_due", "reminder"] },
  { key: "comment", types: ["task_comment"] },
  { key: "updates", types: ["task_status", "task_updated", "template_shared"] },
  { key: "approval", types: ["approval_request", "approval_result"] },
  { key: "invite", types: ["workspace_invite", "workspace_invite_result", "role_changed", "role_change_result"] },
  { key: "okr", types: ["objective_risk"] },
  { key: "ai", types: ["ai_suggestion"] },
  { key: "recognition", types: ["kudos", "kudos_reaction", "reward_request", "reward_result"] },
];

const ROLE_ORDER = ["viewer", "contributor", "editor", "admin", "owner"];

function snoozeTimes() {
  const now = new Date();
  const inHours = (h: number) => new Date(now.getTime() + h * 3600_000);
  const tomorrow9 = new Date(now);
  tomorrow9.setDate(now.getDate() + 1);
  tomorrow9.setHours(9, 0, 0, 0);
  const nextMon = new Date(now);
  nextMon.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  nextMon.setHours(9, 0, 0, 0);
  return [
    { key: "snooze.1h", at: inHours(1) },
    { key: "snooze.3h", at: inHours(3) },
    { key: "snooze.tomorrow", at: tomorrow9 },
    { key: "snooze.nextWeek", at: nextMon },
  ] as const;
}

/** Inbox as an action center: what needs you, with the action right on the row. */
export function InboxView() {
  const { t } = useT();
  const router = useRouter();
  const [view, setView] = useState<View>("todo");
  const [group, setGroup] = useState("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: NotificationItem[] }>(`/api/notifications?view=${view}`);
      setItems(r.items);
    } finally {
      setLoaded(true);
    }
  }, [view]);

  useEffect(() => {
     
    load();
  }, [load]);

  const counts = useMemo(() => Object.fromEntries(GROUPS.map((g) => [g.key, g.types.length ? items.filter((n) => g.types.includes(n.type)).length : items.length])), [items]);
  const shown = useMemo(() => {
    const g = GROUPS.find((x) => x.key === group)!;
    return g.types.length ? items.filter((n) => g.types.includes(n.type)) : items;
  }, [items, group]);

  async function act(n: NotificationItem, body: Record<string, unknown>, okKey?: MessageKey) {
    try {
      await api.patch(`/api/notifications/${n.id}`, body);
      if (okKey) toast.success(t(okKey));
      await load();
      fetchInbox().catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  /** Approve / reject straight from the row (reject asks for a short reason). */
  async function decide(n: NotificationItem, decision: "approve" | "reject") {
    const approvalId = (n.data as { approvalId?: string } | null)?.approvalId;
    if (!approvalId) return;
    const note = decision === "reject" ? window.prompt(t("ac.rejectReason")) : "";
    if (note === null) return;
    try {
      await api.patch(`/api/approvals/${approvalId}`, { decision, note: note || undefined });
      toast.success(t(decision === "approve" ? "ac.approved" : "ac.rejected"));
      await load();
      fetchInbox().catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  /** Workspace invitation: the notification links to /invite/<token>. */
  async function decideReward(n: NotificationItem, action: "approve" | "reject") {
    const id = String(n.data?.redemptionId ?? "");
    if (!id) return open(n);
    const note = action === "reject" ? window.prompt(t("reco.admin.rejectNote")) : "";
    if (note === null) return;
    try {
      await api.patch(`/api/redemptions/${id}`, { action, note: note || undefined });
      toast.success(action === "approve" ? t("reco.admin.approvedToast") : t("reco.admin.rejectedToast"));
      await load();
      fetchInbox().catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      load();
    }
  }

  async function answerRole(n: NotificationItem, decision: "accept" | "decline") {
    if (decision === "decline" && !confirm(t("role.declineConfirm"))) return;
    try {
      await api.post(`/api/notifications/${n.id}/role-response`, { decision });
      toast.success(decision === "accept" ? t("role.acceptedToast") : t("role.declinedToast"));
      await load();
      fetchInbox().catch(() => {});
      if (decision === "decline") router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
      load();
    }
  }

  async function answerInvite(n: NotificationItem, decision: "accept" | "decline") {
    const token = n.link?.split("/invite/")[1];
    if (!token) return;
    try {
      const r = await api.post<{ joined: boolean; slug: string | null }>(`/api/invite/${token}`, { decision });
      toast.success(decision === "accept" ? t("inv.joined", { name: n.title }) : t("inv.declinedTitle"));
      if (r.joined && r.slug) {
        router.push(`/w/${r.slug}`);
        router.refresh();
        return;
      }
      await load();
      fetchInbox().catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    }
  }

  function open(n: NotificationItem) {
    if (!n.read) act(n, { read: true });
    if (n.link) router.push(n.link);
  }

  return (
    <div className="flex-1 overflow-y-auto thin-scroll">
      <div className="max-w-4xl mx-auto p-6" data-testid="action-center">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-neutral-900 dark:text-neutral-50">{t("ac.title")}</h1>
            <p className="text-sm text-neutral-500">{t("ac.subtitle")}</p>
          </div>
          <div className="flex rounded-lg border border-neutral-200 dark:border-neutral-800 p-0.5 bg-white dark:bg-neutral-900">
            {(["todo", "all", "snoozed"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={cn("text-xs rounded-md px-2.5 py-1", view === v ? "bg-indigo-600 text-white" : "text-neutral-500 hover:text-neutral-800")} data-testid={`ac-view-${v}`}>
                {t(`ac.view.${v}` as MessageKey)}
              </button>
            ))}
          </div>
          <Button variant="outline" onClick={async () => { await markAllRead(); load(); }}>
            <CheckCheck size={14} /> {t("notif.markAll")}
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-3">
          {GROUPS.map((g) => (
            <button key={g.key} onClick={() => setGroup(g.key)} className={cn("text-xs rounded-full border px-2.5 py-1", group === g.key ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" : "border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800")} data-testid={`ac-group-${g.key}`}>
              {t(`ac.group.${g.key}` as MessageKey)} <span className="opacity-60">{counts[g.key] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 divide-y divide-neutral-100 dark:divide-neutral-800 overflow-hidden">
          {loaded && shown.length === 0 && (
            <div className="py-16 flex flex-col items-center gap-2 text-neutral-400">
              <Inbox size={28} />
              <span className="text-sm">{view === "todo" ? t("ac.emptyTodo") : t("notif.empty")}</span>
            </div>
          )}
          {shown.map((n) => (
            <div key={n.id} className={cn("group flex gap-3 px-4 py-3", !n.read && "bg-indigo-50/30 dark:bg-indigo-950/10")} data-testid="ac-item">
              {n.actor ? (
                <span className="relative overflow-hidden h-9 w-9 rounded-full text-white text-[11px] font-semibold flex items-center justify-center shrink-0" style={{ backgroundColor: n.actor.avatarColor }}>
                  {initials(n.actor.name)}
                  <AvatarImg id={n.actor.id} />
                </span>
              ) : n.type === "ai_suggestion" ? (
                <span className="h-9 w-9 rounded-full flex items-center justify-center shrink-0 bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
                  <Sparkles size={15} />
                </span>
              ) : (
                <span className={cn("h-9 w-9 rounded-full flex items-center justify-center shrink-0", n.type === "task_overdue" || n.type === "objective_risk" ? "bg-red-100 text-red-600 dark:bg-red-950" : "bg-amber-100 text-amber-600 dark:bg-amber-950")}>
                  <Clock size={15} />
                </span>
              )}
              <button onClick={() => open(n)} className="flex-1 min-w-0 text-left">
                <span className="block text-xs text-neutral-500">{describeNotification(n, t)}</span>
                <span className="block text-sm font-semibold text-neutral-800 dark:text-neutral-100 truncate">{notificationTitle(n, t)}</span>
                {n.body && <span className="block text-xs text-neutral-500 line-clamp-2">{n.body}</span>}
                <Meta className="mt-1">
                  {n.projectName && <MetaChip>{n.projectName}</MetaChip>}
                  {n.workspaceName && <span className="truncate">{n.workspaceName}</span>}
                  <MetaItem icon={Clock3}>{timeAgo(n.createdAt, t)}</MetaItem>
                  {n.snoozedUntil && <MetaItem icon={AlarmClockOff} className="text-amber-600">{t("ac.snoozedUntil", { when: new Date(n.snoozedUntil).toLocaleString() })}</MetaItem>}
                </Meta>
              </button>
              <div className="flex items-start gap-1 shrink-0">
                <ActionButton icon={ExternalLink} label={t("ac.open")} onClick={() => open(n)} />
                {n.type === "task_assigned" && !n.actioned && <ActionButton icon={UserCheck} label={t("ac.accept")} onClick={() => act(n, { actioned: true }, "ac.accepted")} testId="ac-accept" />}
                {n.taskOpen && (n.type === "task_assigned" || n.type === "task_due_soon" || n.type === "task_overdue" || n.type === "task_due_changed" || n.type === "mention") && (
                  <ActionButton icon={CheckCircle2} label={t("ac.complete")} onClick={() => act(n, { completeTask: true }, "ac.completed")} testId="ac-complete" />
                )}
                {n.type === "objective_risk" && <ActionButton icon={Eye} label={t("ac.review")} onClick={() => open(n)} />}
                {n.type === "approval_request" && !n.actioned && (
                  <>
                    <ActionButton icon={ThumbsUp} label={t("ac.approve")} onClick={() => decide(n, "approve")} testId="ac-approve" />
                    <ActionButton icon={ThumbsDown} label={t("ac.reject")} onClick={() => decide(n, "reject")} testId="ac-reject" />
                  </>
                )}
                {n.type === "workspace_invite" && !n.actioned && (
                  <>
                    <ActionButton icon={UserCheck} label={t("inv.accept")} onClick={() => answerInvite(n, "accept")} testId="ac-invite-accept" />
                    <ActionButton icon={ThumbsDown} label={t("inv.decline")} onClick={() => answerInvite(n, "decline")} testId="ac-invite-decline" />
                  </>
                )}
                {n.type === "reward_request" && !n.actioned && !!n.data?.redemptionId && (
                  <>
                    <ActionButton icon={ThumbsUp} label={t("reco.admin.approve")} onClick={() => decideReward(n, "approve")} testId="ac-reward-approve" />
                    <ActionButton icon={ThumbsDown} label={t("reco.admin.reject")} onClick={() => decideReward(n, "reject")} testId="ac-reward-reject" />
                  </>
                )}
                {n.type === "role_changed" && !n.actioned && (
                  <>
                    <ActionButton icon={UserCheck} label={t("role.accept")} onClick={() => answerRole(n, "accept")} testId="ac-role-accept" />
                    {ROLE_ORDER.indexOf(String(n.data?.to)) > ROLE_ORDER.indexOf(String(n.data?.from)) && <ActionButton icon={ThumbsDown} label={t("role.decline")} onClick={() => answerRole(n, "decline")} testId="ac-role-decline" />}
                  </>
                )}
                {n.type === "ai_suggestion" && (
                  <ActionButton
                    icon={Sparkles}
                    label={t("ac.runAi")}
                    onClick={() => {
                      act(n, { actioned: true });
                      if (n.link) router.push(n.link);
                    }}
                    testId="ac-run-ai"
                  />
                )}
                {!n.actioned && n.type !== "task_assigned" && n.type !== "role_changed" && <ActionButton icon={Check} label={t("ac.done")} onClick={() => act(n, { actioned: true })} testId="ac-done" />}
                {n.snoozedUntil ? (
                  <ActionButton icon={AlarmClockOff} label={t("ac.unsnooze")} onClick={() => act(n, { snoozeUntil: null })} />
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="rounded-md p-1.5 text-neutral-400 hover:text-indigo-600 hover:bg-neutral-100 dark:hover:bg-neutral-800" title={t("ac.snooze")} data-testid="ac-snooze">
                        <Clock size={15} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {snoozeTimes().map((s) => (
                        <DropdownMenuItem key={s.key} onSelect={() => act(n, { snoozeUntil: s.at.toISOString() }, "ac.snoozed")}>
                          {t(s.key as MessageKey)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-neutral-400 mt-3">{t("ac.note")}</p>
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, testId }: { icon: React.ComponentType<{ size?: number }>; label: string; onClick: () => void; testId?: string }) {
  return (
    <button onClick={onClick} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-indigo-50 hover:text-indigo-700 dark:hover:bg-indigo-950" title={label} data-testid={testId}>
      <Icon size={13} /> <span className="hidden md:inline">{label}</span>
    </button>
  );
}
