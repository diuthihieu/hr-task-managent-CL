"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Target, CheckCircle2, AlertTriangle, XCircle, TrendingUp, ListChecks } from "lucide-react";
import { api } from "@/lib/api-client";
import { Select } from "@/components/ui/misc";
import { ChartRenderer, CHART_COLORS } from "@/components/dashboard/chart-renderer";
import { DeadlineLabel, ProgressBar, StatusBadge } from "./okr-ui";
import type { TeamRow } from "@/types";

interface DashboardStats {
  total: number;
  onTrack: number;
  atRisk: number;
  offTrack: number;
  completed: number;
  notStarted: number;
  avgProgress: number;
  objectivesByStatus: { status: string; count: number }[];
  progressByTeam: { id: string; name: string; avgProgress: number; count: number }[];
  progressByOwner: { id: string; name: string; avgProgress: number; count: number }[];
  keyResultTotal: number;
  keyResultCompleted: number;
  tasksContributing: number;
  upcomingDeadlines: { id: string; title: string; endDate: string; progress: number; status: string; teamName: string | null }[];
}

interface MemberLite {
  id: string;
  name: string;
}

export function OkrDashboard({ workspaceId, workspaceSlug }: { workspaceId: string; workspaceSlug: string }) {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [members, setMembers] = useState<MemberLite[]>([]);
  const [filters, setFilters] = useState({ teamId: "", ownerId: "", status: "", cycleType: "" });

  useEffect(() => {
    const params = new URLSearchParams();
    if (filters.teamId) params.set("teamId", filters.teamId);
    if (filters.ownerId) params.set("ownerId", filters.ownerId);
    if (filters.status) params.set("status", filters.status);
    if (filters.cycleType) params.set("cycleType", filters.cycleType);
    api.get<DashboardStats>(`/api/workspaces/${workspaceId}/okr-dashboard?${params}`).then(setStats);
  }, [workspaceId, filters]);

  useEffect(() => {
    api.get<TeamRow[]>(`/api/workspaces/${workspaceId}/teams`).then(setTeams).catch(() => {});
    api.get<MemberLite[]>(`/api/workspaces/${workspaceId}/members`).then(setMembers).catch(() => {});
  }, [workspaceId]);

  if (!stats) return <div className="flex-1 flex items-center justify-center text-sm text-neutral-400">Loading…</div>;

  const statusLabels: Record<string, string> = { not_started: "Not Started", on_track: "On Track", at_risk: "At Risk", off_track: "Off Track", completed: "Completed" };
  const statusColors: Record<string, string> = { not_started: "#94a3b8", on_track: "#22c55e", at_risk: "#eab308", off_track: "#ef4444", completed: "#6366f1" };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-4 h-12 border-b border-neutral-200 dark:border-neutral-800 shrink-0">
        <h1 className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">OKR Dashboard</h1>
        <div className="ml-auto flex items-center gap-1.5">
          <Select className="w-32" value={filters.teamId} onValueChange={(v) => setFilters((f) => ({ ...f, teamId: v }))} options={[{ value: "", label: "All teams" }, ...teams.map((t) => ({ value: t.id, label: t.name }))]} />
          <Select className="w-32" value={filters.ownerId} onValueChange={(v) => setFilters((f) => ({ ...f, ownerId: v }))} options={[{ value: "", label: "All owners" }, ...members.map((m) => ({ value: m.id, label: m.name }))]} />
          <Select className="w-28" value={filters.status} onValueChange={(v) => setFilters((f) => ({ ...f, status: v }))} options={[{ value: "", label: "All status" }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} />
          <Select className="w-28" value={filters.cycleType} onValueChange={(v) => setFilters((f) => ({ ...f, cycleType: v }))} options={[{ value: "", label: "All cycles" }, { value: "quarter", label: "Quarter" }, { value: "year", label: "Year" }, { value: "custom", label: "Custom" }]} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto thin-scroll p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Kpi icon={<Target size={15} />} label="Total Objectives" value={stats.total} />
          <Kpi icon={<TrendingUp size={15} />} label="Avg Progress" value={`${Math.round(stats.avgProgress)}%`} accent="#6366f1" />
          <Kpi icon={<CheckCircle2 size={15} />} label="On Track" value={stats.onTrack} accent="#22c55e" />
          <Kpi icon={<AlertTriangle size={15} />} label="At Risk" value={stats.atRisk} accent="#eab308" />
          <Kpi icon={<XCircle size={15} />} label="Off Track" value={stats.offTrack} accent="#ef4444" />
          <Kpi icon={<ListChecks size={15} />} label="Tasks Contributing" value={stats.tasksContributing} accent="#0ea5e9" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
            <h3 className="text-xs font-semibold text-neutral-500 mb-2">Objectives by Status</h3>
            <div style={{ height: 200 }}>
              <ChartRenderer
                type="donut"
                series={stats.objectivesByStatus.filter((s) => s.count > 0).map((s) => ({ key: s.status, label: statusLabels[s.status] ?? s.status, value: s.count, color: statusColors[s.status] }))}
              />
            </div>
          </div>
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
            <h3 className="text-xs font-semibold text-neutral-500 mb-2">Progress by Team</h3>
            <div style={{ height: 200 }}>
              <ChartRenderer type="column" series={stats.progressByTeam.map((t, i) => ({ key: t.id, label: t.name, value: Math.round(t.avgProgress), color: CHART_COLORS[i % CHART_COLORS.length] }))} measureLabel="Avg %" />
            </div>
          </div>
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
            <h3 className="text-xs font-semibold text-neutral-500 mb-2">Progress by Owner</h3>
            <div style={{ height: 200 }}>
              <ChartRenderer type="column" series={stats.progressByOwner.map((o, i) => ({ key: o.id, label: o.name, value: Math.round(o.avgProgress), color: CHART_COLORS[i % CHART_COLORS.length] }))} measureLabel="Avg %" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
            <h3 className="text-xs font-semibold text-neutral-500 mb-2">Key Result Completion</h3>
            <div className="flex items-center gap-3">
              <ProgressBar value={stats.keyResultTotal ? (stats.keyResultCompleted / stats.keyResultTotal) * 100 : 0} height={8} />
              <span className="text-sm font-medium tabular-nums shrink-0">
                {stats.keyResultCompleted}/{stats.keyResultTotal}
              </span>
            </div>
            <p className="text-[11px] text-neutral-400 mt-1.5">Key Results at 100% progress</p>
          </div>
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
            <h3 className="text-xs font-semibold text-neutral-500 mb-2">Upcoming OKR Deadlines</h3>
            <div className="space-y-1.5">
              {stats.upcomingDeadlines.length === 0 && <p className="text-xs text-neutral-400">Nothing due soon.</p>}
              {stats.upcomingDeadlines.map((d) => (
                <Link key={d.id} href={`/w/${workspaceSlug}/okrs/${d.id}`} className="flex items-center gap-2 text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800/60 rounded-md px-1 py-1 -mx-1">
                  <span className="flex-1 truncate text-neutral-700 dark:text-neutral-300">{d.title}</span>
                  <StatusBadge status={d.status} />
                  <DeadlineLabel endDate={d.endDate} />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, accent = "#64748b" }: { icon: React.ReactNode; label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3">
      <div className="flex items-center gap-1.5 text-neutral-400 mb-1.5" style={{ color: accent }}>
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-xl font-semibold text-neutral-900 dark:text-neutral-50 tabular-nums">{value}</div>
    </div>
  );
}
