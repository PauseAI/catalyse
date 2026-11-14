# Two vitest runs at once wipe each other's databases and coverage

Size: S. Kind: tools.

## Problem

Every vitest run shares one test template database, one `vitest_` schema prefix and one `coverage/` directory. A second run in the same checkout, or in another worktree against the same Postgres, drops the first one's databases mid-run (`dropStale` in `test/pg.ts` drops every `vitest_` schema, not just its own run's) or refuses to start on the coverage lock. The failures read as "template database does not exist", "table … does not exist", `PrismaClientInitializationError` or "Server has closed the connection", with every file passing alone.

## Fix

A per-run database prefix and reports directory in `test/pg.ts` and `scripts/test-unit.ts`, from an env var or the pid, with `dropStale` dropping only stale runs' schemas.

## Hits

- 2026-10-15 (x6): P4-05, P4-14, P4-07, P4-20 and P4-19 runs beside other agents' runs in the same checkout failed 49 to 100 suites or refused to start on the coverage lock; in Phase 6 two agents' single-file runs of the project page test dropped each other's databases, so each waited for the other
- 2026-10-23: the dependency-lag rework, in its own worktree, lost 78 tests when another worktree's run started mid-run
