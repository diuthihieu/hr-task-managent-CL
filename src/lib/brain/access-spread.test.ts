import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

// The brainAccess() filters (access.ts) are merged into queries with object spread.
// A key written after `...access.page` replaces the same key of the access rule
// (BUG-29: a NOT or AND that dropped "hidden project" from the filter), so no
// object literal may spread access.<x> and then set a key that filter already has.
const RULE_KEYS: Record<string, string[]> = {
  page: ["workspaceId", "deletedAt", "wiki", "NOT"],
  task: ["workspaceId", "deletedAt", "project"],
  objective: ["workspaceId", "deletedAt", "OR"],
  decision: ["workspaceId", "deletedAt", "AND"],
  project: ["workspaceId", "deletedAt", "hiddenMembers"],
};

const ROOT = join(__dirname, "..", "..");
function* sources(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* sources(p);
    else if (/\.tsx?$/.test(e.name) && !e.name.endsWith(".test.ts")) yield p;
  }
}

test("no query spreads a brainAccess filter and then overrides one of its keys", () => {
  const problems: string[] = [];
  for (const file of sources(ROOT)) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("...access.")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isObjectLiteralExpression(node)) {
        let rule: string | null = null;
        for (const prop of node.properties) {
          if (ts.isSpreadAssignment(prop) && ts.isPropertyAccessExpression(prop.expression) && prop.expression.expression.getText(sf) === "access" && RULE_KEYS[prop.expression.name.text]) {
            rule = prop.expression.name.text;
          } else if (rule && prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) && RULE_KEYS[rule].includes(prop.name.text)) {
            const { line } = sf.getLineAndCharacterOfPosition(prop.getStart(sf));
            problems.push(`${relative(ROOT, file)}:${line + 1} sets ${prop.name.text} after ...access.${rule}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  assert.deepEqual(problems, [], "combine with { AND: [access.x, { ... }] } instead");
});
