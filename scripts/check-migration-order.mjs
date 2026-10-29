#!/usr/bin/env node
// CI guard (BUG-03): Prisma applies migrations in folder-name order, and many
// existing folders carry future dates (up to 2027), so `prisma migrate dev`
// (which names new folders after the real UTC time) would slot a new one into
// the middle. Every migration added by a PR must sort after every migration on
// the base branch. Existing folders are never renamed (production's
// _prisma_migrations table refers to them by name).
//
//   BASE_REF=master node scripts/check-migration-order.mjs
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const NAME = /^\d{14}_/;

/** Problems with the migrations in `current` that are not in `base` (pure, unit tested). */
export function migrationOrderProblems(base, current) {
  const known = new Set(base);
  const newest = [...base].sort().at(-1) ?? "";
  const problems = [];
  for (const name of current.filter((n) => !known.has(n)).sort()) {
    if (!NAME.test(name)) problems.push(`${name}: the folder name must start with 14 digits and "_" (YYYYMMDDHHMMSS_name)`);
    else if (name <= newest) problems.push(`${name}: must sort after the newest existing migration ${newest} - rename it (e.g. one number above that prefix) before committing`);
  }
  return problems;
}

function main() {
  const baseRef = process.env.BASE_REF || "master";
  let base;
  try {
    base = execFileSync("git", ["ls-tree", "--name-only", `origin/${baseRef}:prisma/migrations`], { encoding: "utf8" }).split("\n").filter(Boolean);
  } catch {
    console.warn(`[migrations] origin/${baseRef} not found (not fetched?) - skipping the order check`);
    return;
  }
  const dir = "prisma/migrations";
  const isMigration = (n) => n !== "migration_lock.toml" && statSync(join(dir, n)).isDirectory();
  const current = readdirSync(dir).filter(isMigration);
  const problems = migrationOrderProblems(base.filter((n) => n !== "migration_lock.toml"), current);
  if (problems.length) {
    console.error(`[migrations] New migrations out of order:\n - ${problems.join("\n - ")}`);
    process.exit(1);
  }
  console.log("[migrations] order OK");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
