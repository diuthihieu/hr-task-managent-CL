#!/usr/bin/env bash
# Vercel "Ignored Build Step" (vercel.json "ignoreCommand").
# Exit 1 = build, exit 0 = skip. Every Vercel build keeps ~100 MB of function
# bundles in Functions Storage, so only builds that ship are made:
#   - production / pushes to master (the release),
#   - deployments not started by a git push (dashboard redeploy, CLI),
#   - any commit whose message contains [preview] (an on-demand preview).
# Other branch pushes are skipped; GitHub CI still builds and tests every PR.
set -u

if [ "${VERCEL_ENV:-}" = "production" ] || [ "${VERCEL_GIT_COMMIT_REF:-}" = "master" ]; then
  echo "[ignore-build] production / master: building"; exit 1
fi
if [ -z "${VERCEL_GIT_COMMIT_REF:-}" ]; then
  echo "[ignore-build] not a git push: building"; exit 1
fi
case "${VERCEL_GIT_COMMIT_MESSAGE:-}" in
  *"[preview]"*) echo "[ignore-build] [preview] requested: building"; exit 1 ;;
esac
echo "[ignore-build] branch ${VERCEL_GIT_COMMIT_REF}: preview skipped (add [preview] to the commit message to build one)"
exit 0
