#!/usr/bin/env bash
# Vercel build step (package.json "vercel-build").
# Schema changes go through `prisma migrate deploy` only - never manual SQL.
#
# Order matters: the app is built FIRST, so a failing build never leaves the
# database migrated for code that won't ship. Only then (production builds,
# or previews with MIGRATE_ON_PREVIEW=1) the legacy-data guard, migrations and
# the one-time admin bootstrap run; if they fail, the deployment fails and the
# previous version keeps serving. Migrations must stay backward compatible
# (expand -> deploy -> contract) because the old version serves until the new
# one is promoted. Set SKIP_BUILD_MIGRATIONS=1 to run them as a separate,
# approved release job instead (npm run db:release).
set -euo pipefail

npx prisma generate
npx next build

if [ "${SKIP_BUILD_MIGRATIONS:-}" = "1" ]; then
  echo "[vercel-build] SKIP_BUILD_MIGRATIONS=1: migrations are run by the release job."
elif [ "${VERCEL_ENV:-}" = "production" ] || [ "${MIGRATE_ON_PREVIEW:-}" = "1" ]; then
  node prisma/check-legacy-data.mjs
  npx prisma migrate deploy
  npx tsx prisma/bootstrap-admin.ts
else
  echo "[vercel-build] VERCEL_ENV=${VERCEL_ENV:-unset}: skipping migrations (set MIGRATE_ON_PREVIEW=1 to run them)."
fi
