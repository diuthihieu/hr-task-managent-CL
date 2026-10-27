import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Platform overview for woli system administrators: counts only. Nothing here reads workspace content
 * (tasks, comments, files, wiki); per workspace it shows its name, owner and sizes so operators can see
 * which workspaces are in use. "Active" = signed in or did anything logged (activity log) in the window.
 * AI usage comes from ai_usage_events (token counts per Gemini call - never prompts or answers);
 * storage = task / wiki files + AI knowledge documents + Agent Work output files that are not deleted.
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
  ai: { requests30: number; tokensIn30: number; tokensOut30: number; requestsAll: number; tokensAll: number };
  /** Token use per feature (API route) in the last 30 days, biggest first. */
  aiFeatures: { feature: string; requests: number; tokens: number }[];
  weekly: { week: string; signups: number; workspaces: number; activeUsers: number; aiTokens: number }[];
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
    aiRequests30: number;
    aiTokens30: number;
    aiTokensAll: number;
  }[];
  /** People with their AI use and uploaded storage (most AI tokens in 30 days first, up to USER_ROWS). */
  userRows: {
    id: string;
    name: string;
    email: string;
    workspaces: number;
    aiRequests30: number;
    aiTokens30: number;
    aiTokensAll: number;
    storageBytes: number;
    lastAiAt: string | null;
  }[];
}

export const USER_ROWS = 500;

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
      (SELECT coalesce(sum(size_bytes), 0) FROM attachments WHERE deleted_at IS NULL)
        + (SELECT coalesce(sum(size_bytes), 0) FROM knowledge_docs WHERE deleted_at IS NULL)
        + (SELECT coalesce(sum(size_bytes), 0) FROM agent_outputs WHERE deleted_at IS NULL) AS storage,
      (SELECT count(*) FROM ai_messages WHERE role = 'user' AND created_at >= now() - interval '30 days') AS ai30,
      (SELECT count(*) FROM ai_usage_events WHERE created_at >= now() - interval '30 days') AS ai_req30,
      (SELECT coalesce(sum(tokens_in), 0) FROM ai_usage_events WHERE created_at >= now() - interval '30 days') AS ai_in30,
      (SELECT coalesce(sum(tokens_out), 0) FROM ai_usage_events WHERE created_at >= now() - interval '30 days') AS ai_out30,
      (SELECT count(*) FROM ai_usage_events) AS ai_req_all,
      (SELECT coalesce(sum(tokens_in + tokens_out), 0) FROM ai_usage_events) AS ai_tok_all`);

  const features = await prisma.$queryRaw<{ feature: string; requests: bigint; tokens: bigint }[]>(Prisma.sql`
    SELECT feature, count(*) AS requests, coalesce(sum(tokens_in + tokens_out), 0) AS tokens
    FROM ai_usage_events WHERE created_at >= now() - interval '30 days'
    GROUP BY feature ORDER BY tokens DESC, requests DESC LIMIT 30`);

  const weekly = await prisma.$queryRaw<{ week: Date; signups: bigint; workspaces: bigint; active: bigint; ai_tokens: bigint }[]>(Prisma.sql`
    WITH weeks AS (
      SELECT generate_series(date_trunc('week', now()) - ${OVERVIEW_WEEKS - 1} * interval '1 week', date_trunc('week', now()), interval '1 week') AS week
    )
    SELECT w.week,
      (SELECT count(*) FROM users WHERE deleted_at IS NULL AND created_at >= w.week AND created_at < w.week + interval '1 week') AS signups,
      (SELECT count(*) FROM workspaces WHERE deleted_at IS NULL AND created_at >= w.week AND created_at < w.week + interval '1 week') AS workspaces,
      (SELECT count(DISTINCT actor_id) FROM activity_logs WHERE actor_id IS NOT NULL AND created_at >= w.week AND created_at < w.week + interval '1 week') AS active,
      (SELECT coalesce(sum(tokens_in + tokens_out), 0) FROM ai_usage_events WHERE created_at >= w.week AND created_at < w.week + interval '1 week') AS ai_tokens
    FROM weeks w ORDER BY w.week`);

  const rows = await prisma.$queryRaw<
    { id: string; name: string; owner_name: string | null; owner_email: string | null; created_at: Date; members: bigint; projects: bigint; tasks: bigint; storage: bigint; last_at: Date | null; ai_req30: bigint; ai_tok30: bigint; ai_tok_all: bigint }[]
  >(Prisma.sql`
    SELECT w.id, w.name, w.created_at,
      o.name AS owner_name, o.email AS owner_email,
      (SELECT count(*) FROM workspace_members m JOIN users mu ON mu.id = m.user_id WHERE m.workspace_id = w.id AND mu.deleted_at IS NULL) AS members,
      (SELECT count(*) FROM projects p WHERE p.workspace_id = w.id AND p.deleted_at IS NULL) AS projects,
      (SELECT count(*) FROM tasks t WHERE t.workspace_id = w.id AND t.deleted_at IS NULL) AS tasks,
      (SELECT coalesce(sum(size_bytes), 0) FROM attachments a WHERE a.workspace_id = w.id AND a.deleted_at IS NULL)
        + (SELECT coalesce(sum(size_bytes), 0) FROM knowledge_docs k WHERE k.workspace_id = w.id AND k.deleted_at IS NULL)
        + (SELECT coalesce(sum(size_bytes), 0) FROM agent_outputs g WHERE g.workspace_id = w.id AND g.deleted_at IS NULL) AS storage,
      (SELECT max(created_at) FROM activity_logs l WHERE l.workspace_id = w.id) AS last_at,
      coalesce(ai.req30, 0) AS ai_req30, coalesce(ai.tok30, 0) AS ai_tok30, coalesce(ai.tok_all, 0) AS ai_tok_all
    FROM workspaces w
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE e.created_at >= now() - interval '30 days') AS req30,
        coalesce(sum(e.tokens_in + e.tokens_out) FILTER (WHERE e.created_at >= now() - interval '30 days'), 0) AS tok30,
        coalesce(sum(e.tokens_in + e.tokens_out), 0) AS tok_all
      FROM ai_usage_events e WHERE e.workspace_id = w.id
    ) ai ON true
    LEFT JOIN LATERAL (
      SELECT u.name, u.email FROM workspace_members m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = w.id AND m.role = 'owner' LIMIT 1
    ) o ON true
    WHERE w.deleted_at IS NULL
    ORDER BY last_at DESC NULLS LAST, w.created_at DESC`);

  const people = await prisma.$queryRaw<
    { id: string; name: string; email: string; workspaces: bigint; ai_req30: bigint; ai_tok30: bigint; ai_tok_all: bigint; storage: bigint; last_ai: Date | null }[]
  >(Prisma.sql`
    SELECT u.id, u.name, u.email,
      (SELECT count(*) FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id WHERE m.user_id = u.id AND w.deleted_at IS NULL) AS workspaces,
      coalesce(ai.req30, 0) AS ai_req30, coalesce(ai.tok30, 0) AS ai_tok30, coalesce(ai.tok_all, 0) AS ai_tok_all, ai.last_ai,
      (SELECT coalesce(sum(size_bytes), 0) FROM attachments a WHERE a.uploaded_by = u.id AND a.deleted_at IS NULL)
        + (SELECT coalesce(sum(size_bytes), 0) FROM knowledge_docs k WHERE k.created_by = u.id AND k.deleted_at IS NULL)
        + (SELECT coalesce(sum(size_bytes), 0) FROM agent_outputs g WHERE g.created_by = u.id AND g.deleted_at IS NULL) AS storage
    FROM users u
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE e.created_at >= now() - interval '30 days') AS req30,
        coalesce(sum(e.tokens_in + e.tokens_out) FILTER (WHERE e.created_at >= now() - interval '30 days'), 0) AS tok30,
        coalesce(sum(e.tokens_in + e.tokens_out), 0) AS tok_all,
        max(e.created_at) AS last_ai
      FROM ai_usage_events e WHERE e.user_id = u.id
    ) ai ON true
    WHERE u.deleted_at IS NULL
    ORDER BY ai_tok30 DESC, ai_tok_all DESC, storage DESC, u.created_at
    LIMIT ${USER_ROWS}`);

  return {
    generatedAt: new Date().toISOString(),
    users: { total: n(u.total), verified: n(u.verified), disabled: n(u.disabled), admins: n(u.admins), new7: n(u.new7), new30: n(u.new30), active7: n(u.active7), active30: n(u.active30) },
    workspaces: { total: n(c.ws_total), new30: n(c.ws_new30), active30: n(c.ws_active30) },
    projects: { total: n(c.projects) },
    tasks: { total: n(c.tasks), new30: n(c.tasks_new30) },
    storageBytes: n(c.storage),
    aiQuestions30: n(c.ai30),
    ai: { requests30: n(c.ai_req30), tokensIn30: n(c.ai_in30), tokensOut30: n(c.ai_out30), requestsAll: n(c.ai_req_all), tokensAll: n(c.ai_tok_all) },
    aiFeatures: features.map((f) => ({ feature: f.feature, requests: n(f.requests), tokens: n(f.tokens) })),
    weekly: weekly.map((w) => ({ week: w.week.toISOString().slice(0, 10), signups: n(w.signups), workspaces: n(w.workspaces), activeUsers: n(w.active), aiTokens: n(w.ai_tokens) })),
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
      aiRequests30: n(r.ai_req30),
      aiTokens30: n(r.ai_tok30),
      aiTokensAll: n(r.ai_tok_all),
    })),
    userRows: people.map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email,
      workspaces: n(p.workspaces),
      aiRequests30: n(p.ai_req30),
      aiTokens30: n(p.ai_tok30),
      aiTokensAll: n(p.ai_tok_all),
      storageBytes: n(p.storage),
      lastAiAt: p.last_ai ? p.last_ai.toISOString() : null,
    })),
  };
}
