# A new git worktree can't run the suite until it's set up by hand

Size: S. Kind: tools.

## Problem

A fresh worktree has no `.env`/`.env.local`, `node_modules` or `generated/`. The unit tier fails with "DATABASE_URL is not set", a symlinked `node_modules` breaks the e2e build ("points out of the filesystem root"), and `npm run generate` needs a `DATABASE_URL` before it runs.

## Fix

A `scripts/new-worktree.ts` (or a step in Orca's worktree setup) that links the env files, clones `node_modules` (`cp -cR`) and copies `generated/`, so a side worktree works first time.

## Hits

- 2026-10-15 (x2): a worktree beside another session's changes needed the env files linked and `node_modules` cloned; an Orca worktree for the status-badge review needed `npm ci`, a dummy `DATABASE_URL`, `CHECKPOINT_DISABLE=1` and `node --import tsx` to typecheck, and could run no unit test
- 2026-10-23: the dependency-lag rework's worktree had no `.env.local`, so `npm run generate` failed until it was copied
