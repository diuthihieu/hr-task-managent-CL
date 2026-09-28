import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { htmlToText } from "./ai/extract";

type Db = Prisma.TransactionClient | typeof prisma;

const MIN_TASK_TITLE = 8;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Projects whose data a piece of wiki text quotes: the project's name as a
 * whole word, or one of its task titles (8+ characters, so "Le" or "Like"
 * don't match everything). Deliberately errs on the side of matching - a false
 * positive only hides a page from people who can't see that project anyway.
 * Mirrors the backfill in migration 20261123090000_wiki_page_source_projects.
 */
export async function detectSourceProjects(db: Db, workspaceId: string, text: string): Promise<string[]> {
  const hay = text.normalize("NFC").toLowerCase();
  if (!hay.trim()) return [];
  const projects = await db.project.findMany({
    where: { workspaceId, deletedAt: null },
    select: { id: true, name: true, tasks: { where: { deletedAt: null }, select: { title: true } } },
  });
  const hits: string[] = [];
  for (const p of projects) {
    const name = p.name.normalize("NFC").trim().toLowerCase();
    const byName = name.length >= 2 && new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, "u").test(hay);
    const byTask =
      !byName &&
      p.tasks.some((t) => {
        const title = t.title.normalize("NFC").trim().toLowerCase();
        return title.length >= MIN_TASK_TITLE && hay.includes(title);
      });
    if (byName || byTask) hits.push(p.id);
  }
  return hits;
}

/** Re-detects a page's source projects from its title, body and comments (call after every save). */
export async function refreshPageSources(db: Db, pageId: string): Promise<string[]> {
  const page = await db.wikiPage.findUniqueOrThrow({
    where: { id: pageId },
    select: { workspaceId: true, title: true, content: true, sourceProjectIds: true, comments: { where: { deletedAt: null }, select: { body: true } } },
  });
  const text = [page.title, htmlToText(page.content), ...page.comments.map((c) => c.body)].join("\n");
  const ids = await detectSourceProjects(db, page.workspaceId, text);
  // Raw update so a comment doesn't bump the page's "last edited" time.
  if ([...ids].sort().join() !== [...page.sourceProjectIds].sort().join())
    await db.$executeRaw`UPDATE wiki_pages SET source_project_ids = ${ids}::uuid[] WHERE id = ${pageId}::uuid`;
  return ids;
}

/** Source projects that actually restrict the page (someone is hidden from them), for the page's notice. */
export async function restrictingProjects(db: Db, sourceProjectIds: string[]): Promise<{ id: string; name: string }[]> {
  if (!sourceProjectIds.length) return [];
  return db.project.findMany({ where: { id: { in: sourceProjectIds }, deletedAt: null, hiddenMembers: { some: {} } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

/** Prisma filter: wiki pages that quote none of the projects hidden from the viewer. */
export function visiblePageWhere(hidden: Set<string>): Prisma.WikiPageWhereInput {
  return hidden.size ? { NOT: { sourceProjectIds: { hasSome: [...hidden] } } } : {};
}
