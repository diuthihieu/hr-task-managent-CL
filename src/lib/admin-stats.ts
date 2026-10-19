import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Platform overview for woli system administrators: counts only. Nothing here reads workspace content
 * (tasks, comments, files, wiki); per workspace it shows its name, owner and sizes so operators can see
 * which workspaces are in use. "Active" = signed in or did anything logged (activity log) in the window.
 */

export const OVERVIEW_WEEKS = 12;

export interface AdminOverview {
  generatedAt: string;
  users: { total: number; verified: number; disabled: number; admins: number; new7: number; new30: number; active7: number; active30: number };
  workspaces: { total: number; new30: number; active30: number };
  projects: { total: number };
  tasks: { total: number; new30: number };
  storageBytes: number;
  aiQuestions30: number;
  weekly: { week: string; signups: number; workspaces: number; activeUsers: number }[];
  workspaceRows: {
    id: string;
    name: string;
    ownerName: string | null;
    ownerEmail: string | null;
    createdAt: string;
    members: number;
    projects: number;
    tasks: number;
    storageBytes: number;
    lastActivityAt: string | null;
  }[];
}

const n = (v: unknown) => Number(v ?? 0);

export async function loadAdminOverview(): Promise<AdminOverview> {
  const [u] = await prisma.$queryRaw<Record<string, bigint>[]>(Prisma.sql`
    WITH live AS (SELECT * FROM users WHERE deleted_at IS NULL),
    acted AS (
      SELECT actor_id AS id, max(created_at) AS at FROM activity_logs
      WHERE actor_id IS NOT NULL AND created_at >= now() - interval '30 days' GROUP BY actor_id
    )
    SELECT
      count(*) AS total,
      count(*) FILTER (WHERE email_verified_at IS NOT NULL) AS verified,
      count(*) FILTER (WHERE NOT is_active) AS disabled,
      count(*) FILTER (WHERE system_role = 'ADMIN') AS admins,
      count(*) FILTER (WHERE created_at >= now() - interval '7 days') AS new7,
      count(*) FILTER (WHERE created_at >= now() - interval '30 days') AS new30,
      count(*) FILTER (WHERE greatest(last_login_at, a.at) >= now() - interval '7 days') AS active7,
      count(*) FILTER (WHERE greatest(last_login_at, a.at) >= now() - interval '30 days') AS active30
    FROM live LEFT JOIN acted a ON a.id = live.id`);

  const [c] = await prisma.$queryRaw<Record<string, bigint>[]>(Prisma.sql`
    SELECT
      (SELECT count(*) FROM workspaces WHERE deleted_at IS NULL) AS ws_total,
      (SELECT count(*) FROM workspaces WHERE deleted_at IS NULL AND created_at >= now() - interval '30 days') AS ws_new30,
      (SELECT count(DISTINCT l.workspace_id) FROM activity_logs l JOIN workspaces w ON w.id = l.workspace_id
         WHERE w.deleted_at IS NULL AND l.created_at >= now() - interval '30 days') AS ws_active30,
      (SELECT count(*) FROM projects p JOIN workspaces w ON w.id = p.workspace_id WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL) AS projects,
      (SELECT count(*) FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE t.deleted_at IS NULL AND w.deleted_at IS NULL) AS tasks,
      (SELECT count(*) FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE t.deleted_at IS NULL AND w.deleted_at IS NULL AND t.created_at >= now() - interval '30 days') AS tasks_new30,
      (SELECT coalesce(sum(size_bytes), 0) FROM attachments WHERE deleted_at IS NULL) AS storage,
      (SELECT count(*) FROM ai_messages WHERE role = 'user' AND created_at >= now() - interval '30 days') AS ai30`);

  const weekly = await prisma.$queryRaw<{ week: Date; signups: bigint; workspaces: bigint; active: bigint }[]>(Prisma.sql`
    WITH weeks AS (
      SELECT generate_series(date_trunc('week', now()) - ${OVERVIEW_WEEKS - 1} * interval '1 week', date_trunc('week', now()), interval '1 week') AS week
    )
    SELECT w.week,
      (SELECT count(*) FROM users WHERE deleted_at IS NULL AND created_at >= w.week AND created_at < w.week + interval '1 week') AS signups,
      (SELECT count(*) FROM workspaces WHERE deleted_at IS NULL AND created_at >= w.week AND created_at < w.week + interval '1 week') AS workspaces,
      (SELECT count(DISTINCT actor_id) FROM activity_logs WHERE actor_id IS NOT NULL AND created_at >= w.week AND created_at < w.week + interval '1 week') AS active
    FROM weeks w ORDER BY w.week`);

  const rows = await prisma.$queryRaw<
    { id: string; name: string; owner_name: string | null; owner_email: string | null; created_at: Date; members: bigint; projects: bigint; tasks: bigint; storage: bigint; last_at: Date | null }[]
  >(Prisma.sql`
    SELECT w.id, w.name, w.created_at,
      o.name AS owner_name, o.email AS owner_email,
      (SELECT count(*) FROM workspace_members m JOIN users mu ON mu.id = m.user_id WHERE m.workspace_id = w.id AND mu.deleted_at IS NULL) AS members,
      (SELECT count(*) FROM projects p WHERE p.workspace_id = w.id AND p.deleted_at IS NULL) AS projects,
      (SELECT count(*) FROM tasks t WHERE t.workspace_id = w.id AND t.deleted_at IS NULL) AS tasks,
      (SELECT coalesce(sum(size_bytes), 0) FROM attachments a WHERE a.workspace_id = w.id AND a.deleted_at IS NULL) AS storage,
      (SELECT max(created_at) FROM activity_logs l WHERE l.workspace_id = w.id) AS last_at
    FROM workspaces w
    LEFT JOIN LATERAL (
      SELECT u.name, u.email FROM workspace_members m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = w.id AND m.role = 'owner' LIMIT 1
    ) o ON true
    WHERE w.deleted_at IS NULL
    ORDER BY last_at DESC NULLS LAST, w.created_at DESC`);

  return {
    generatedAt: new Date().toISOString(),
    users: { total: n(u.total), verified: n(u.verified), disabled: n(u.disabled), admins: n(u.admins), new7: n(u.new7), new30: n(u.new30), active7: n(u.active7), active30: n(u.active30) },
    workspaces: { total: n(c.ws_total), new30: n(c.ws_new30), active30: n(c.ws_active30) },
    projects: { total: n(c.projects) },
    tasks: { total: n(c.tasks), new30: n(c.tasks_new30) },
    storageBytes: n(c.storage),
    aiQuestions30: n(c.ai30),
    weekly: weekly.map((w) => ({ week: w.week.toISOString().slice(0, 10), signups: n(w.signups), workspaces: n(w.workspaces), activeUsers: n(w.active) })),
    workspaceRows: rows.map((r) => ({
      id: r.id,
      name: r.name,
      ownerName: r.owner_name,
      ownerEmail: r.owner_email,
      createdAt: r.created_at.toISOString(),
      members: n(r.members),
      projects: n(r.projects),
      tasks: n(r.tasks),
      storageBytes: n(r.storage),
      lastActivityAt: r.last_at ? r.last_at.toISOString() : null,
    })),
  };
}
