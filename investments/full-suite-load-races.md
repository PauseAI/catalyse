# Races that only show under full-suite load cost a full check-all each

Size: M. Kind: tools.

## Problem

A test that races only under full-suite load fails one `check-all` run, passes 8/8 when run alone, and the next race shows only on the next run of up to ten minutes. The causes repeat: a `getBy…` or `getByText` read before a refetch or query lands (a textarea's value mirrored into its text counts as "on screen"), a `vi.waitFor` or `findBy…` one-second default outlasted under load, a wait for any alert satisfied by an earlier toast, and the access matrix (`test/access-matrix.ts`) building a fresh world for each persona in turn, so `tasks-access` and `projects-access` sit near the node timeout even alone.

## Fix

1. A script that reruns one suspect file under the same parallel load (all unit files at once, only the suspect repeated), so a race is found in one pass instead of one per full run.
2. Build each access matrix's world once per file, or run the roles of one `expectAccess` concurrently, to keep it well clear of the timeout.

`flaky-tests-under-load-sweep.md` covers the same cost from the other side (several full runs, every failure listed); doing either may be enough.

## Hits

- 2026-09-24 (x3): `ProjectEditor.test.tsx` failed three ways across four runs (a 5 s database poll, a title long enough to start autosave, a real bug dropping edits made during the first autosave); e2e `01` reloaded before a background mark-read landed; e2e `16` read a reply's text in the box as proof it was saved; `ProjectEditor` read a button that follows a refetch with `getBy…`
- 2026-10-15 (x5): the Add Task button read "Adding…" while autosave created the draft; the Inbox test opened a row before it showed as read; e2e `36` Save Changes still "Saving…" after 10 s; e2e `34` a project pushed off the overview by other specs' projects; e2e `23` a reload's aborted request signed the user out; the owner-picker debounce outlived its picker; `ProjectEditor` clicked a still-disabled Submit, one per ten-minute run
- 2026-10-15: main's first CI run hit e2e `30`, where `transferProjectOwnership` waited for any alert and an approval toast still up satisfied it
- 2026-10-16: three `check-all` runs in a row each failed one unrelated unit file (`ProjectEditor.test.tsx`, `app/quick-tasks/page.test.tsx`, `server/routers/quickTasks.test.ts`), each passing alone in under 40 s
- 2026-10-17: passed `check-all` locally, failed in CI: two component tests acted before a query had loaded
- 2026-10-23: `ProjectEditor` Submit opened its dialog only after a fresh fetch that outlasted `findByText`'s default
- 2026-10-26: `app/signup/page.test.tsx` resend outlasted `vi.waitFor`'s default, and the fake clock it left behind timed out every later test in the file, so one race read as ten failures
- 2026-11-05 (x2): the access matrix timed out under full-suite load in two runs, passing eight reruns alone
- 2026-11-11 (x3): e2e `39` polled `lagDays` past 5 s; `scripts/disposable-db.test.ts`'s `DROP DATABASE` hook outlasted 10 s twice; e2e `09` failed 3 in 11 on `16`'s race, found in one read from a trace with both pages' network timings (`postComment` in `e2e/actions/ui.ts` now waits for the box to empty); `jobs/deadline-reminders.test.ts` ran past the node project's 5 s default (raised to 20 s); `ProjectEditor` "admins publish org projects directly" failed alone 3 in 6 even after cancelling in-flight queries, cause not yet found
- 2026-11-11: `tasks-access` "are reviewed by its admins, owner and deputies" timed out at 20 s, 8/8 alone
- 2026-11-11: three `tasks-access` tests timed out; with the host loaded the file failed two of 17 alone, on `main` too
- 2026-11-12: `check-all` timed out seven tests across the access matrix, `cron-audit`, `concurrency` and `skills`; run alone, `tasks-access` still failed two of 17 and `projects-access` one of 23 at 20 s, in a change touching no code
