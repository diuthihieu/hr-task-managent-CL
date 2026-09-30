import { NextResponse } from "next/server";
import { route } from "@/lib/authz";
import { htmlToText } from "@/lib/ai/extract";
import { entityHref } from "@/lib/brain/links-core";
import { brainContext } from "@/lib/brain/route-helpers";
import { conflictCandidates } from "@/lib/brain/health";
import { assertAi, brainSystem, generateJson, str } from "@/lib/brain/ai";

type P = { workspaceId: string };

export const maxDuration = 120;

/**
 * AI check for conflicting information between related current pages (same
 * tag / similar title). Returns suggestions only; nothing is edited.
 */
export const POST = route<P>(async (_req, { params }) => {
  const { workspaceId } = await params;
  const { user, access, base } = await brainContext(workspaceId);
  await assertAi(user.id);
  const pairs = await conflictCandidates(access);
  if (!pairs.length) return NextResponse.json({ checkedPairs: 0, conflicts: [] });
  const data = pairs
    .map(([a, b], i) => `### PAIR ${i + 1}\n[A] ${a.title} (updated ${a.updatedAt.toISOString().slice(0, 10)})\n${htmlToText(a.content).slice(0, 2500)}\n\n[B] ${b.title} (updated ${b.updatedAt.toISOString().slice(0, 10)})\n${htmlToText(b.content).slice(0, 2500)}`)
    .join("\n\n");
  const system = brainSystem({
    task: "For each PAIR, decide whether A and B state conflicting facts (different numbers, rules, owners, dates or steps for the same thing). Report ONLY real conflicts, quoting both statements briefly, and suggest how a person could resolve it (which page looks newer / which to update). Do not rewrite the pages.",
    schema: '{"conflicts":[{"pair":1,"issue":"...","quoteA":"...","quoteB":"...","suggestion":"..."}]}',
    locale: user.locale ?? "vi",
    data,
    responseName: "conflicts",
  });
  const r = await generateJson<{ conflicts?: { pair?: unknown; issue?: unknown; quoteA?: unknown; quoteB?: unknown; suggestion?: unknown }[] }>(workspaceId, system);
  const conflicts = (Array.isArray(r.conflicts) ? r.conflicts : [])
    .map((c) => ({ c, pair: pairs[Number(c.pair) - 1] }))
    .filter((x) => x.pair && str(x.c.issue))
    .map(({ c, pair: [a, b] }) => ({
      a: { id: a.id, title: a.title, href: entityHref(base, { type: "wiki", id: a.id, wikiId: a.wikiId }) },
      b: { id: b.id, title: b.title, href: entityHref(base, { type: "wiki", id: b.id, wikiId: b.wikiId }) },
      issue: str(c.issue, 1000),
      quoteA: str(c.quoteA, 500),
      quoteB: str(c.quoteB, 500),
      suggestion: str(c.suggestion, 1000),
    }));
  return NextResponse.json({ checkedPairs: pairs.length, conflicts });
});
