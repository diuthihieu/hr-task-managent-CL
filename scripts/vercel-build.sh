#!/usr/bin/env bash
# Vercel build step (package.json "vercel-build").
# Schema changes go through `prisma migrate deploy` only - never manual SQL.
# Migrations + admin bootstrap run on production builds; preview builds skip
# them unless MIGRATE_ON_PREVIEW=1 (previews usually share the production
# database, and a feature branch must not migrate it).
set -euo pipefail

npx prisma generate

if [ "${VERCEL_ENV:-}" = "production" ] || [ "${MIGRATE_ON_PREVIEW:-}" = "1" ]; then
  npx prisma migrate deploy
  npx tsx prisma/bootstrap-admin.ts
else
  echo "[vercel-build] VERCEL_ENV=${VERCEL_ENV:-unset}: skipping migrations (set MIGRATE_ON_PREVIEW=1 to run them)."
fi

npx next build
