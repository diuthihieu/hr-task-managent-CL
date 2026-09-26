#!/usr/bin/env bash
# Integration tests: throwaway PostgreSQL database + real server + HTTP tests.
#   TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/basework_it npm run test:integration
# Requires `npm run build` first. The database named in TEST_DATABASE_URL is DROPPED and recreated.
set -euo pipefail

TEST_DATABASE_URL="${TEST_DATABASE_URL:-postgresql://basework:basework@localhost:5432/basework_it}"
DB_NAME="${TEST_DATABASE_URL##*/}"; DB_NAME="${DB_NAME%%\?*}"
case "$DB_NAME" in *_it|*_test) ;; *) echo "Refusing: test database name must end in _it or _test (got $DB_NAME)"; exit 1;; esac
MAINT_URL="${TEST_DATABASE_URL%/*}/postgres"
PORT="${TEST_PORT:-3100}"

psql "$MAINT_URL" -qc "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);" -c "CREATE DATABASE \"$DB_NAME\";"

export DATABASE_URL="$TEST_DATABASE_URL" DIRECT_URL="$TEST_DATABASE_URL"
export AUTH_SECRET="${AUTH_SECRET:-integration-test-secret-integration-test-secret}" AUTH_TRUST_HOST=true
export ADMIN_EMAIL=admin@integration.test ADMIN_PASSWORD=Bootstrap123 ADMIN_NAME="Integration Admin"
unset BLOB_READ_WRITE_TOKEN

npx prisma migrate deploy >/dev/null
npx tsx prisma/bootstrap-admin.ts

if curl -s -o /dev/null "http://localhost:$PORT"; then echo "Port $PORT is already in use - stop that server first"; exit 1; fi
# Run next directly (not via npx) in its own process group so cleanup kills the whole tree.
setsid node_modules/.bin/next start -p "$PORT" >/tmp/basework-it-server.log 2>&1 &
SERVER_PID=$!
trap 'kill -- -$SERVER_PID 2>/dev/null || true; fuser -k "$PORT/tcp" 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do curl -sf "http://localhost:$PORT/login" >/dev/null && break; sleep 1; done

TEST_BASE_URL="http://localhost:$PORT" node --import tsx --test --test-concurrency=1 tests/integration/*.test.ts
