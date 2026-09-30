import "server-only";
import { prisma } from "../prisma";
import { entityHref, parseContentLinks } from "./links-core";
import { resolveTargets } from "./connections";
import type { BrainAccess } from "./access";

// Knowledge health: detects problems and SUGGESTS what to do. Nothing here
// changes knowledge - fixes are always a person's click.

export type HealthIssueType = "outdated" | "duplicate" | "unlinked" | "never_revisited" | "missing_source" | "broken_link" | "stale_reference";
export type HealthAction = "mark_checked" | "mark_outdated" | "archive" | "add_source" | "fix_link" | "add_links" | "merge" | "review" | "update_link";

export interface HealthIssue {
  type: HealthIssueType;
  pageId: string;
  title: string;
  href?: string;
  /** Details for the message (dates, the other page, the broken link text…). */
  detail: Record<string, string | number | null>;
  suggestion: HealthAction;
  severity: "high" | "medium" | "low";
}

const DAY = 86400000;
const norm = (s: string) => s.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length >= 3));

export async function knowledgeHealth(access: BrainAccess, base: string, now = new Date()) {
  const pages = await prisma.wikiPage.findMany({
    where: { ...access.page, status: { not: "archived" } },
    select: {
      id: true,
      title: true,
      wikiId: true,
      content: true,
      tags: true,
      kind: true,
      status: true,
      validTo: true,
      createdAt: true,
      updatedAt: true,
      lastViewedAt: true,
      lastCheckedAt: true,
      sourceType: true,
      sourceLabel: true,
      sourceUrl: true,
      sourceRef: true,
      confidence: true,
      parentPageId: true,
      _count: { select: { attachments: { where: { deletedAt: null } } } },
    },
    take: 3000,
    orderBy: { updatedAt: "desc" },
  });
  const today = new Date(now.toISOString().slice(0, 10));
  const href = (p: { id: string; wikiId: string }) => entityHref(base, { type: "wiki", id: p.id, wikiId: p.wikiId });
  const issues: HealthIssue[] = [];
  const add = (p: (typeof pages)[number], type: HealthIssueType, suggestion: HealthAction, severity: HealthIssue["severity"], detail: HealthIssue["detail"] = {}) =>
    issues.push({ type, pageId: p.id, title: p.title || "Untitled", href: href(p), detail, suggestion, severity });

  // Links between pages (and from tasks) for "unlinked" and broken links.
  const outgoing = new Map(pages.map((p) => [p.id, parseContentLinks(p.content)]));
  const linkedTo = new Set<string>();
  for (const links of outgoing.values()) for (const l of links) if (l.type === "wiki") linkedTo.add(l.id);
  const taskLinks = await prisma.task.findMany({ where: { ...access.task, content: { contains: "/wiki/" } }, select: { content: true }, take: 3000 });
  for (const t of taskLinks) for (const l of parseContentLinks(t.content)) if (l.type === "wiki") linkedTo.add(l.id);
  const allTargets = [...new Set([...outgoing.values()].flat().map((l) => l.target))];
  const resolved = await resolveTargets(access, base, allTargets, true);
  const statusOf = new Map(pages.map((p) => [p.id, p]));

  for (const p of pages) {
    // Outdated: marked so, validity ended, or not touched/checked for 6 months.
    const stale = p.updatedAt < new Date(now.getTime() - 180 * DAY) && (!p.lastCheckedAt || p.lastCheckedAt < new Date(now.getTime() - 180 * DAY));
    if (p.status === "outdated") add(p, "outdated", "archive", "medium", { reason: "marked" });
    else if (p.status === "current" && p.validTo && p.validTo < today) add(p, "outdated", "mark_outdated", "high", { reason: "expired", validTo: p.validTo.toISOString().slice(0, 10) });
    else if (p.status === "current" && stale) add(p, "outdated", "mark_checked", "low", { reason: "stale", updatedAt: p.updatedAt.toISOString().slice(0, 10) });

    // Unlinked: no links in or out and no tags - hard to ever find again.
    const out = outgoing.get(p.id)!;
    if (!out.length && !linkedTo.has(p.id) && !p.tags.length && p.createdAt < new Date(now.getTime() - 2 * DAY)) add(p, "unlinked", "add_links", "low");

    // Never revisited: older than a month and not opened for 90 days.
    if (p.createdAt < new Date(now.getTime() - 30 * DAY) && (!p.lastViewedAt || p.lastViewedAt < new Date(now.getTime() - 90 * DAY))) add(p, "never_revisited", "review", "low", { lastViewedAt: p.lastViewedAt?.toISOString().slice(0, 10) ?? null });

    // Missing source: imported / AI / converted knowledge without provenance, or low confidence without a source.
    const hasSource = !!(p.sourceLabel || p.sourceUrl || p.sourceRef);
    if (!hasSource && (p.sourceType !== "manual" || p.confidence === "low" || (p.kind === "process" && !p._count.attachments && !out.length)))
      add(p, "missing_source", "add_source", p.sourceType === "ai_generated" ? "high" : "medium", { sourceType: p.sourceType });

    // Broken links (deleted / inaccessible targets, missing blocks) and links to superseded knowledge.
    for (const l of out) {
      const r = resolved.get(l.target);
      if (!r) add(p, "broken_link", "fix_link", "high", { text: l.text, target: l.type });
      else if (l.blockId && r.blocks && !r.blocks.has(l.blockId)) add(p, "broken_link", "fix_link", "medium", { text: l.text, target: "block" });
      else if (l.type === "wiki" && p.status === "current" && (r.status === "superseded" || statusOf.get(l.id)?.status === "outdated")) add(p, "stale_reference", "update_link", "medium", { text: l.text, other: r.label, otherHref: r.href ?? null });
    }
  }

  // Duplicates: same normalized title, or near-identical titles (word overlap ≥ 80%).
  const current = pages.filter((p) => p.status !== "superseded").slice(0, 1500);
  const seenPair = new Set<string>();
  for (let i = 0; i < current.length; i++) {
    const a = current[i];
    const wa = words(a.title);
    for (let j = i + 1; j < current.length; j++) {
      const b = current[j];
      const same = norm(a.title) && norm(a.title) === norm(b.title);
      let similar = false;
      if (!same && wa.size >= 2) {
        const wb = words(b.title);
        const inter = [...wa].filter((w) => wb.has(w)).length;
        similar = inter / Math.max(wa.size, wb.size) >= 0.8;
      }
      if (same || similar) {
        const key = [a.id, b.id].sort().join();
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        add(a, "duplicate", "merge", same ? "medium" : "low", { other: b.title, otherId: b.id, otherHref: href(b) ?? null });
      }
    }
  }

  const counts = Object.fromEntries((["outdated", "duplicate", "unlinked", "never_revisited", "missing_source", "broken_link", "stale_reference"] as HealthIssueType[]).map((t) => [t, issues.filter((i) => i.type === t).length]));
  const rank = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { pageCount: pages.length, counts, issues: issues.slice(0, 500) };
}

/** Candidate pairs for the AI "conflicting information" check: current pages sharing a tag or with similar titles. */
export async function conflictCandidates(access: BrainAccess, limit = 10) {
  const pages = await prisma.wikiPage.findMany({
    where: { ...access.page, status: "current" },
    select: { id: true, title: true, wikiId: true, tags: true, content: true, updatedAt: true, validFrom: true, validTo: true },
    orderBy: { updatedAt: "desc" },
    take: 400,
  });
  const pairs: [(typeof pages)[number], (typeof pages)[number]][] = [];
  for (let i = 0; i < pages.length && pairs.length < limit; i++)
    for (let j = i + 1; j < pages.length && pairs.length < limit; j++) {
      const a = pages[i];
      const b = pages[j];
      const tag = a.tags.some((t) => b.tags.includes(t));
      const wa = words(a.title);
      const wb = words(b.title);
      const overlap = [...wa].filter((w) => wb.has(w)).length;
      if (tag || overlap >= 2) pairs.push([a, b]);
    }
  return pairs;
}
