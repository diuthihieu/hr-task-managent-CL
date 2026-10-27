"use client";
import { useEffect, useMemo, useState } from "react";
import { Download, RefreshCw, Users, Building2, FolderKanban, ListChecks, HardDrive, Sparkles, Activity } from "lucide-react";
import { api } from "@/lib/api-client";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/components/i18n-provider";
import { cn } from "@/lib/utils";

interface Overview {
  generatedAt: string;
  users: { total: number; verified: number; disabled: number; admins: number; new7: number; new30: number; active7: number; active30: number };
  workspaces: { total: number; new30: number; active30: number };
  projects: { total: number };
  tasks: { total: number; new30: number };
  storageBytes: number;
  aiQuestions30: number;
  ai: { requests30: number; tokensIn30: number; tokensOut30: number; requestsAll: number; tokensAll: number };
  aiFeatures: { feature: string; requests: number; tokens: number }[];
  weekly: { week: string; signups: number; workspaces: number; activeUsers: number; aiTokens: number }[];
  workspaceRows: { id: string; name: string; ownerName: string | null; ownerEmail: string | null; createdAt: string; members: number; projects: number; tasks: number; storageBytes: number; lastActivityAt: string | null; aiRequests30: number; aiTokens30: number; aiTokensAll: number }[];
  userRows: { id: string; name: string; email: string; workspaces: number; aiRequests30: number; aiTokens30: number; aiTokensAll: number; storageBytes: number; lastAiAt: string | null }[];
}

const fmt = (n: number) => n.toLocaleString("vi-VN");
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const dmy = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("vi-VN") : "—");
function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);

/** Platform overview for woli system administrators: totals, 12-week trends and every workspace's size. */
export function AdminOverview() {
  const { t } = useT();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [userQuery, setUserQuery] = useState("");

  async function load() {
    setLoading(true);
    try {
      setData(await api.get<Overview>("/api/admin/stats"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("common.failed"));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = data?.workspaceRows ?? [];
    return q ? list.filter((r) => `${r.name} ${r.ownerName ?? ""} ${r.ownerEmail ?? ""}`.toLowerCase().includes(q)) : list;
  }, [data, query]);
  const people = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    const list = data?.userRows ?? [];
    return q ? list.filter((r) => `${r.name} ${r.email}`.toLowerCase().includes(q)) : list;
  }, [data, userQuery]);

  function exportCsv() {
    if (!data) return;
    const esc = (v: string | number | null) => {
      const s = v === null ? "" : String(v);
      return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      [t("ao.csvWorkspace"), t("ao.owner"), t("ao.ownerEmail"), t("ao.created"), t("ao.members"), t("ao.projects"), t("ao.tasks"), t("ao.storageMb"), t("ao.lastActivity"), t("ao.aiReq30"), t("ao.aiTok30"), t("ao.aiTokAll")].map(esc).join(","),
      ...data.workspaceRows.map((r) => [r.name, r.ownerName, r.ownerEmail, r.createdAt.slice(0, 10), r.members, r.projects, r.tasks, (r.storageBytes / 1048576).toFixed(2), r.lastActivityAt?.slice(0, 10) ?? "", r.aiRequests30, r.aiTokens30, r.aiTokensAll].map(esc).join(",")),
      "",
      [t("ao.user"), t("ao.email"), t("ao.workspaces"), t("ao.aiReq30"), t("ao.aiTok30"), t("ao.aiTokAll"), t("ao.storageMb"), t("ao.lastAi")].map(esc).join(","),
      ...data.userRows.map((r) => [r.name, r.email, r.workspaces, r.aiRequests30, r.aiTokens30, r.aiTokensAll, (r.storageBytes / 1048576).toFixed(2), r.lastAiAt?.slice(0, 10) ?? ""].map(esc).join(",")),
      "",
      [t("ao.feature"), t("ao.aiReq30"), t("ao.aiTok30")].map(esc).join(","),
      ...data.aiFeatures.map((f) => [f.feature, f.requests, f.tokens].map(esc).join(",")),
      "",
      [t("ao.csvWeek"), t("ao.signups"), t("ao.newWorkspaces"), t("ao.activeUsers"), t("ao.aiTokens")].map(esc).join(","),
      ...data.weekly.map((w) => [w.week, w.signups, w.workspaces, w.activeUsers, w.aiTokens].join(",")),
    ];
    // BOM so Excel opens Vietnamese text correctly.
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `woli-tong-quan-${data.generatedAt.slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (loading && !data) return <div className="text-neutral-400 py-10">{t("common.loading")}</div>;
  if (!data) return null;

  const { users, workspaces } = data;
  return (
    <div className="space-y-5" data-testid="admin-overview">
      <div className="flex items-center gap-2">
        <p className="text-xs text-neutral-500">{t("ao.lead", { time: new Date(data.generatedAt).toLocaleString("vi-VN") })}</p>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> {t("ao.refresh")}
          </Button>
          <Button variant="secondary" onClick={exportCsv} data-testid="ao-export">
            <Download size={13} /> {t("ao.export")}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile icon={Users} label={t("ao.users")} value={users.total} sub={t("ao.usersSub", { verified: fmt(users.verified), disabled: fmt(users.disabled) })} testId="ao-users" />
        <Tile icon={Activity} label={t("ao.active30")} value={users.active30} sub={t("ao.activeSub", { n7: fmt(users.active7) })} />
        <Tile icon={Users} label={t("ao.new30")} value={users.new30} sub={t("ao.newSub", { n7: fmt(users.new7) })} />
        <Tile icon={Building2} label={t("ao.workspaces")} value={workspaces.total} sub={t("ao.workspacesSub", { active: fmt(workspaces.active30), created: fmt(workspaces.new30) })} testId="ao-workspaces" />
        <Tile icon={FolderKanban} label={t("ao.projects")} value={data.projects.total} />
        <Tile icon={ListChecks} label={t("ao.tasks")} value={data.tasks.total} sub={t("ao.tasksSub", { n: fmt(data.tasks.new30) })} />
        <Tile icon={HardDrive} label={t("ao.storage")} text={bytes(data.storageBytes)} />
        <Tile icon={Sparkles} label={t("ao.aiTokens30")} value={data.ai.tokensIn30 + data.ai.tokensOut30} sub={t("ao.aiSub", { req: fmt(data.ai.requests30), tin: fmt(data.ai.tokensIn30), tout: fmt(data.ai.tokensOut30), all: fmt(data.ai.tokensAll) })} testId="ao-ai" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        <WeeklyBars title={t("ao.signups")} points={data.weekly.map((w) => ({ week: w.week, value: w.signups }))} />
        <WeeklyBars title={t("ao.newWorkspaces")} points={data.weekly.map((w) => ({ week: w.week, value: w.workspaces }))} />
        <WeeklyBars title={t("ao.activeUsers")} points={data.weekly.map((w) => ({ week: w.week, value: w.activeUsers }))} />
        <WeeklyBars title={t("ao.aiTokens")} points={data.weekly.map((w) => ({ week: w.week, value: w.aiTokens }))} />
      </div>

      <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <h2 className="font-medium text-neutral-900 dark:text-neutral-100">{t("ao.wsTable", { n: fmt(data.workspaceRows.length) })}</h2>
          <span className="text-xs text-neutral-500">{t("ao.privacy")}</span>
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("ao.search")} className="ml-auto h-8 w-60" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-neutral-500 bg-neutral-50 dark:bg-neutral-800/40">
              <tr>
                <th className="text-left font-medium px-3 py-2">{t("ao.csvWorkspace")}</th>
                <th className="text-left font-medium px-3 py-2">{t("ao.owner")}</th>
                <th className="text-right font-medium px-3 py-2">{t("ao.members")}</th>
                <th className="text-right font-medium px-3 py-2">{t("ao.projects")}</th>
                <th className="text-right font-medium px-3 py-2">{t("ao.tasks")}</th>
                <th className="text-right font-medium px-3 py-2">{t("ao.storage")}</th>
                <th className="text-right font-medium px-3 py-2">{t("ao.aiTok30")}</th>
                <th className="text-right font-medium px-3 py-2">{t("ao.aiTokAll")}</th>
                <th className="text-left font-medium px-3 py-2">{t("ao.created")}</th>
                <th className="text-left font-medium px-3 py-2">{t("ao.lastActivity")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const idle = daysSince(r.lastActivityAt);
                return (
                  <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-800">
                    <td className="px-3 py-2 font-medium text-neutral-900 dark:text-neutral-100">{r.name}</td>
                    <td className="px-3 py-2">
                      <div className="text-neutral-800 dark:text-neutral-200">{r.ownerName ?? "—"}</div>
                      <div className="text-xs text-neutral-500">{r.ownerEmail ?? ""}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.members)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.projects)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.tasks)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{bytes(r.storageBytes)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" data-testid="ao-ws-ai30">
                      {fmt(r.aiTokens30)}
                      <div className="text-[11px] text-neutral-400">{t("ao.reqN", { n: fmt(r.aiRequests30) })}</div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmt(r.aiTokensAll)}</td>
                    <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{dmy(r.createdAt)}</td>
                    <td className="px-3 py-2">
                      <span className="text-neutral-700 dark:text-neutral-300">{dmy(r.lastActivityAt)}</span>
                      {idle === null || idle > 30 ? (
                        <span className="ml-2 rounded-full bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-500">{t("ao.idle")}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-neutral-400">{t("ao.noMatch")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900" data-testid="ao-users-table">
        <div className="flex flex-wrap items-center gap-2 p-3 border-b border-neutral-200 dark:border-neutral-800">
          <h2 className="font-medium text-neutral-900 dark:text-neutral-100">{t("ao.userTable", { n: fmt(data.userRows.length) })}</h2>
          <span className="text-xs text-neutral-500">{t("ao.userPrivacy")}</span>
          <Input value={userQuery} onChange={(e) => setUserQuery(e.target.value)} placeholder={t("ao.searchUser")} className="ml-auto h-8 w-60" />
        </div>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto thin-scroll">
          <table className="w-full text-sm">
            <thead className="sticky top-0 text-xs text-neutral-500 bg-neutral-50 dark:bg-neutral-800">
              <tr>
                <th className="text-left font-medium px-3 py-2">{t("ao.user")}</th>
                <th className="text-right font-medium px-3 py-2">{t("ao.workspaces")}</th>
                <th className="text-right font-medium px-3 py-2">{t("ao.aiReq30")}</th>
                <th className="text-right font-medium px-3 py-2">{t("ao.aiTok30")}</th>
                <th className="text-right font-medium px-3 py-2">{t("ao.aiTokAll")}</th>
                <th className="text-right font-medium px-3 py-2">{t("ao.storage")}</th>
                <th className="text-left font-medium px-3 py-2">{t("ao.lastAi")}</th>
              </tr>
            </thead>
            <tbody>
              {people.map((r) => (
                <tr key={r.id} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2">
                    <div className="text-neutral-900 dark:text-neutral-100">{r.name}</div>
                    <div className="text-xs text-neutral-500">{r.email}</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.workspaces)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.aiRequests30)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{fmt(r.aiTokens30)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.aiTokensAll)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{bytes(r.storageBytes)}</td>
                  <td className="px-3 py-2 text-neutral-600 dark:text-neutral-400">{dmy(r.lastAiAt)}</td>
                </tr>
              ))}
              {!people.length && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-neutral-400">{t("ao.noMatch")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900" data-testid="ao-features">
        <div className="p-3 border-b border-neutral-200 dark:border-neutral-800">
          <h2 className="font-medium text-neutral-900 dark:text-neutral-100">{t("ao.featureTable")}</h2>
          <p className="text-xs text-neutral-500">{t("ao.featureHint")}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-neutral-500 bg-neutral-50 dark:bg-neutral-800/40">
              <tr>
                <th className="text-left font-medium px-3 py-2">{t("ao.feature")}</th>
                <th className="text-right font-medium px-3 py-2">{t("ao.aiReq30")}</th>
                <th className="text-right font-medium px-3 py-2">{t("ao.aiTok30")}</th>
              </tr>
            </thead>
            <tbody>
              {data.aiFeatures.map((f) => (
                <tr key={f.feature} className="border-t border-neutral-100 dark:border-neutral-800">
                  <td className="px-3 py-2 font-mono text-xs text-neutral-700 dark:text-neutral-300">{f.feature}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(f.requests)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(f.tokens)}</td>
                </tr>
              ))}
              {!data.aiFeatures.length && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-neutral-400">{t("ao.noAi")}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tile({ icon: Icon, label, value, text, sub, testId }: { icon: React.ComponentType<{ size?: number; className?: string }>; label: string; value?: number; text?: string; sub?: string; testId?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3" data-testid={testId}>
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">
        <Icon size={13} className="text-indigo-600 dark:text-indigo-400" />
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-50">{text ?? fmt(value ?? 0)}</div>
      {sub ? <div className="text-xs text-neutral-500 mt-0.5">{sub}</div> : null}
    </div>
  );
}

/** One measure per chart (no shared axis across measures of different scale); hover a week for its value. */
function WeeklyBars({ title, points }: { title: string; points: { week: string; value: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.value));
  const last = points[points.length - 1];
  const shown = hover === null ? last : points[hover];
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{title}</h3>
        <span className="text-xs text-neutral-500 tabular-nums">
          {shown ? `${ddmm(shown.week)}: ` : ""}
          <b className="text-neutral-900 dark:text-neutral-100">{fmt(shown?.value ?? 0)}</b>
        </span>
      </div>
      <div className="mt-3 flex items-end gap-[2px] h-24 border-b border-neutral-200 dark:border-neutral-700" role="img" aria-label={`${title}: ${points.map((p) => `${ddmm(p.week)} ${p.value}`).join(", ")}`} onMouseLeave={() => setHover(null)}>
        {points.map((p, i) => (
          <div key={p.week} className="flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setHover(i)} title={`${ddmm(p.week)}: ${p.value}`}>
            <div
              className={cn("w-full rounded-t-[4px] bg-indigo-500 dark:bg-indigo-400 transition-opacity", hover !== null && hover !== i ? "opacity-40" : "opacity-100")}
              style={{ height: `${p.value ? Math.max(4, (p.value / max) * 100) : 0}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-400 tabular-nums">
        <span>{points[0] ? ddmm(points[0].week) : ""}</span>
        <span>{last ? ddmm(last.week) : ""}</span>
      </div>
    </div>
  );
}
