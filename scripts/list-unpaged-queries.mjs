// BUG-11 (docs/LIST-LIMITS.md): lists .findMany({...}) calls under src/app/api whose first argument has no `take`.
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
const root = process.argv[2] ?? process.cwd();
const out = [];
function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) scan(p); } }
function scan(file) {
  const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  (function visit(n) {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "findMany") {
      const a = n.arguments[0];
      const hasTake = a && ts.isObjectLiteralExpression(a) && a.properties.some((p) => p.name && p.name.getText() === "take");
      if (!hasTake) {
        const { line } = src.getLineAndCharacterOfPosition(n.getStart());
        out.push(`${path.relative(root, file)}:${line + 1}\t${n.expression.expression.getText().replace(/\s+/g, "")}`);
      }
    }
    ts.forEachChild(n, visit);
  })(src);
}
walk(path.join(root, "src/app/api"));
console.log(out.join("\n")); console.error(`${out.length} calls, ${new Set(out.map((l) => l.split(":")[0])).size} files`);
