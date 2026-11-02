#!/usr/bin/env node
// CI guard (BUG-12, docs/SOFT-DELETE.md): 18 models are soft-deleted (a deletedAt column) and every
// read must filter it by hand. This fails when a change adds a read of such a model whose `where`
// is written out but has no `deletedAt` condition (top level or inside AND / OR / NOT), or has no
// `where` at all. Reads that mean to see deleted rows say so right above their own statement (or
// list item / argument), or at the end of the line that names the query:
//   // soft-delete: <why this read includes deleted rows>
// Existing reads are recorded in scripts/soft-delete-baseline.json (per file and query); the
// count per file may go down, never up. Not checked: a `where` built elsewhere (a variable or a
// spread helper - those helpers add deletedAt themselves), relations inside include / select, raw SQL.
//
//   node scripts/check-soft-delete.mjs            check
//   node scripts/check-soft-delete.mjs --update   rewrite the baseline (only after removing reads)
import ts from "typescript";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const READS = new Set(["findMany", "findFirst", "findUnique", "findFirstOrThrow", "findUniqueOrThrow", "count", "aggregate", "groupBy"]);
const LOGIC = new Set(["AND", "OR", "NOT"]);

/** Prisma client names of the models with a deletedAt column, from schema.prisma. */
export function softDeleteModels(schema) {
  return [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].filter((m) => /^\s+deletedAt\s/m.test(m[2])).map((m) => m[1][0].toLowerCase() + m[1].slice(1));
}

const keyName = (p) => (p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null);

/** true when the where literal filters deletedAt itself (or inside AND / OR / NOT), or can't be judged. */
function filtersDeleted(obj) {
  for (const p of obj.properties) {
    if (ts.isSpreadAssignment(p)) return true; // a helper builds part of it
    const k = keyName(p);
    if (k === "deletedAt") return true;
    if (k && LOGIC.has(k) && ts.isPropertyAssignment(p)) {
      const v = p.initializer;
      const parts = ts.isArrayLiteralExpression(v) ? v.elements : [v];
      if (parts.some((e) => !ts.isObjectLiteralExpression(e) || filtersDeleted(e))) return true;
    }
  }
  return false;
}

const MARKER = /^\/\/ soft-delete: \S/;

/** true when the comments right before this read's own statement (or list item / argument /
 *  property) carry the marker - a marker never reaches the next statement or sibling. */
function markerAbove(call, text) {
  for (let node = call; node; node = node.parent) {
    const comments = ts.getLeadingCommentRanges(text, node.getFullStart()) ?? [];
    if (comments.some((c) => MARKER.test(text.slice(c.pos, c.end)))) return true;
    const p = node.parent;
    if (!p || ts.isSourceFile(p) || ts.isBlock(p) || ts.isModuleBlock(p) || ts.isCaseClause(p) || ts.isDefaultClause(p)) return false;
    if (ts.isArrayLiteralExpression(p) || ts.isPropertyAssignment(node) || (ts.isCallExpression(p) && p.arguments.includes(node))) return false;
  }
  return false;
}

/** Unguarded reads in one source file (pure, unit tested): [{ line, query }]. */
export function unguardedReads(fileName, text, models) {
  const src = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const lines = text.split("\n");
  const out = [];
  (function visit(n) {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && READS.has(n.expression.name.text) && ts.isPropertyAccessExpression(n.expression.expression)) {
      const model = n.expression.expression.name.text;
      if (models.includes(model)) {
        const arg = n.arguments[0];
        let guarded;
        if (!arg) guarded = false;
        else if (!ts.isObjectLiteralExpression(arg)) guarded = true;
        else {
          const where = arg.properties.find((p) => keyName(p) === "where") ?? arg.properties.find((p) => ts.isSpreadAssignment(p));
          if (!where) guarded = false;
          else if (ts.isSpreadAssignment(where) || !ts.isPropertyAssignment(where)) guarded = true;
          else guarded = !ts.isObjectLiteralExpression(where.initializer) || filtersDeleted(where.initializer);
        }
        const line = src.getLineAndCharacterOfPosition(n.expression.name.getStart()).line;
        const marked = markerAbove(n, text) || /\/\/ soft-delete: \S/.test(lines[line] ?? "");
        if (!guarded && !marked) out.push({ line: line + 1, query: `${model}.${n.expression.name.text}` });
      }
    }
    ts.forEachChild(n, visit);
  })(src);
  return out;
}

function files(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === "__tests__" ? [] : files(p);
    return /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
  });
}

function main() {
  const root = process.cwd();
  const models = softDeleteModels(readFileSync(join(root, "prisma/schema.prisma"), "utf8"));
  const found = {};
  const where = {};
  for (const f of files(join(root, "src"))) {
    const rel = relative(root, f);
    for (const r of unguardedReads(rel, readFileSync(f, "utf8"), models)) {
      ((found[rel] ??= {})[r.query] = (found[rel]?.[r.query] ?? 0) + 1);
      (where[`${rel}|${r.query}`] ??= []).push(r.line);
    }
  }
  const baselinePath = join(root, "scripts/soft-delete-baseline.json");
  if (process.argv.includes("--update")) {
    writeFileSync(baselinePath, JSON.stringify(found, Object.keys(found).sort().reduce((a, f) => [...a, f, ...Object.keys(found[f])], []), 2) + "\n");
    console.log(`soft-delete baseline updated: ${Object.values(found).reduce((n, q) => n + Object.values(q).reduce((a, b) => a + b, 0), 0)} reads`);
    return;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const problems = [];
  for (const [file, queries] of Object.entries(found))
    for (const [query, n] of Object.entries(queries)) {
      const allowed = baseline[file]?.[query] ?? 0;
      if (n > allowed) problems.push(`${file}:${where[`${file}|${query}`].join(",")} ${query} without a deletedAt condition (${n} here, ${allowed} known). Add deletedAt: null, or mark a deliberate read with "// soft-delete: <why>" on the line above.`);
    }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`soft-delete check: ok (${models.length} models)`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
