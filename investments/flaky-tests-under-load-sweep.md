# Load-dependent flaky tests surface one per `check-all`

Size: M. Kind: tools.

## Problem

Flakes that need load show one per full run, and reproducing one needs load too: running test files side by side collides on the shared test-database setup (`parallel-vitest-runs-collide.md`), so the only way is busy-looping cores by hand.

## Fix

A script that runs the unit suite several times under load and lists every test that failed in any run, so they surface together. It could run nightly. `full-suite-load-races.md` covers the same cost; doing either may be enough.

## Hits

- 2026-10-17: three unrelated flakes (an unawaited notification in `quickTasks.submit`, a scratch-database drop timing out in `disposable-db.test.ts`, a `ProjectEditor` test clicking before its task saved) on three successive runs, each passing alone; with half the cores busy, more of `ProjectEditor` failed on waits that assume a round trip within the default second
