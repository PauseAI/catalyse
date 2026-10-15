#!/usr/bin/env bash
# Runs its arguments normally — except inside Claude Code's Bash sandbox,
# which can't reach the host's Postgres container directly (its own network
# namespace). There, it delegates to `test-db-run` (a host-local script, not
# part of this repo) which re-runs the command in a separate jail with host
# network. Everyone else (regular dev machines, CI) is unaffected: this is a
# transparent passthrough.
#
#   scripts/run-db-test.sh <command...>
set -euo pipefail

if [[ -n "${CLAUDE_CODE_HOST_HTTP_PROXY_PORT:-}" ]]; then
  if command -v test-db-run >/dev/null; then
    exec test-db-run "$@"
  fi
  echo "run-db-test: inside Claude's sandbox but 'test-db-run' isn't on PATH — DB-backed tests can't reach Postgres here. See ~/.claude/CLAUDE.md (this machine) for setup." >&2
  exit 1
fi

exec "$@"
