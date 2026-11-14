# Every worktree's e2e servers use the same ports

Size: S. Kind: tools.

## Problem

Each e2e run starts its servers on ports 4000 up, so a `next-server` another worktree left behind fails global setup with "did not become ready within 30s", and only the server log in `tmp/e2e-server-N.log` says `EADDRINUSE`.

## Fix

Global setup checks the port is free before starting a server and names the process holding it; a per-worktree port block avoids the clash.

## Hits

- 2026-10-24: the PWA work lost two runs to an orphaned server holding port 4004
