// BUG-07: which tasks an edited task's lookup / rollup values can depend on. Lookups and rollups only
// follow outgoing links (sys_parent, sys_depends_on or a link field; never back-links) and formulas read
// their own row, so the tasks reachable through those links are enough. Kept free of Prisma so it can be
// unit tested with an in-memory loader.
import { parseFieldConfig } from "@/lib/field-types";
import type { FieldRow, RecordRow } from "@/types";

/** Most tasks an edit loads to recompute lookups / rollups; past it the whole project is loaded, as before. */
export const LINKED_SET_LIMIT = 2000;
/** Most link levels (one query each) the walk follows; a longer chain loads the whole project in one
 *  query instead, so an edit never queues thousands of round trips inside its transaction. */
export const LINKED_SET_MAX_QUERIES = 8;

export type LinkLoader = (ids: string[]) => Promise<{ id: string; links: string[] }[]>;

/** The link fields that lookup / rollup fields follow. */
export function computedLinkFields(fields: FieldRow[]): string[] {
  const ids = fields.filter((f) => f.type === "lookup" || f.type === "rollup").map((f) => parseFieldConfig(f.config).lookupLinkFieldId).filter((id): id is string => !!id);
  return [...new Set(ids)];
}

/** Outgoing links of a record through the given fields (same reading as resolveComputedFields). */
export function linksOf(record: RecordRow, follow: string[]): string[] {
  return follow.flatMap((f) => {
    const raw = record.data[f];
    return Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
  });
}

/**
 * Ids of `start` and every task reachable from it through the followed links, breadth first; `load`
 * returns the links of the given ids that exist (live, same project) and is called once per level with
 * new ids only. Returns null as soon as the set would pass `limit` or the walk would need more than
 * `maxQueries` levels (the caller loads the whole project).
 */
export async function collectLinkedTaskIds(start: { id: string; links: string[] }, load: LinkLoader, limit = LINKED_SET_LIMIT, maxQueries = LINKED_SET_MAX_QUERIES): Promise<Set<string> | null> {
  const seen = new Set([start.id]);
  let frontier = [...new Set(start.links)].filter((id) => !seen.has(id));
  let queries = 0;
  while (frontier.length) {
    if (seen.size + frontier.length > limit || ++queries > maxQueries) return null;
    for (const id of frontier) seen.add(id);
    const next = new Set<string>();
    for (const row of await load(frontier)) for (const id of row.links) if (!seen.has(id)) next.add(id);
    frontier = [...next];
  }
  return seen;
}
