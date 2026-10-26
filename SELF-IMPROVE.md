# Self-improvement backlog

Each entry starts with a count of how many times the problem has been hit. The
list is **sorted by that count, highest first** — the top of the file is what
this repo pays for most often, and that is the order to fix things in.

An entry is one problem with one fix. When you hit something, look below
first. Bump an entry's count (`1x` → `2x`) only where its fix, had it been
made, would have prevented what you just hit; add what the new instance
taught, and move the entry up to its place. Anything else is a new entry at
`1x`, at the end of the `1x` run, however much it resembles one already here
— a resemblance is not a recurrence, and a count that grows on resemblance
puts a family of small problems above the one the repo pays for most. An
entry whose remedy has landed comes off the list.

Entries live under a heading per count (`## 2x`, `## 1x`), highest first, each
a checkbox whose bold opening sentence names the problem and whose rest names
the fix:

```markdown
## 1x

- [ ] **One sentence naming the problem.** What it cost, and the change to
      the repo that would have prevented it.
```

This is not the issue tracker. A bug or feature in the product belongs in a
GitHub issue. An entry here is about the work itself: something in the code
structure, tooling, tests, docs or diagnostics that made a task slower or more
confusing than it needed to be, and that will do so again.

## 13x

- [ ] **Races that only show under full-suite load surface one per `check-all` run,
      and each costs another run of up to ten minutes.** `ProjectEditor.test.tsx`
      failed in three different ways across four runs (a 5 s database poll, a title
      long enough to start autosave, then a real bug where edits made during the
      first autosave were dropped), and e2e `01` reloaded before a background
      mark-read landed. R-06's run hit e2e `16`, which read a reply's text on screen
      as proof it was saved while the draft was still in the box, and R-09's hit
      `ProjectEditor.test.tsx` again (a button that follows a refetch, read with `getBy…`). Phase 3's
      D-04 run hit it a third time (the Add Task button reads "Adding…" while the title's
      autosave creates the draft) together with the Inbox mark-read test (opening a row
      before it showed as read). Phase 6's second run hit e2e `36`: Save Changes still read
      "Saving…" after 10 s with no toast, then passed 16/16 alone. Its follow-up runs then hit
      four more in turn, one per ten-minute run: e2e `34` (a project pushed off the overview by
      other specs' projects), e2e `23` (a reload's aborted request signing the user out), the
      owner-picker test (a debounce outliving its picker), and `ProjectEditor.test.tsx` again
      (a click on a still-disabled Submit). Each passed 8/8
      when run alone. A script that reruns one
      file under the same parallel load (for example all unit files at once with
      only the suspect repeated) would find them in one pass instead of one per
      full run.
      After the status-badge stack was merged up to main, the unit tier hit
      `scripts/disposable-db.test.ts` twice running (its `DROP DATABASE` hook outlasting 10 s
      while the rest of the suite loads the server), and e2e `09` "Posting a comment notifies
      other participants" failed in three of eleven runs, never when run alone. It was `16`'s
      race again: React mirrors a textarea's value into its text, so `getByText` found the
      comment in the box and the admin opened the inbox before the post landed. A trace with
      both pages' network timings showed it in one read; `postComment` (`e2e/actions/ui.ts`)
      now waits for the box to empty, and every spec that posts a comment uses it. The next
      `check-all` then hit `jobs/deadline-reminders.test.ts`: one test runs the job four times,
      past the node project's five-second default under load; that project now allows 20 s. Main's
      first CI run after the merge hit e2e `30`: `transferProjectOwnership` waited for any alert,
      and the approval toast still up on the same page satisfied it before the transfer saved.
      The settings-page reorganisation hit it a tenth time: three full `check-all` runs in a row
      each failed one unrelated unit file — `ProjectEditor.test.tsx`, `app/quick-tasks/page.test.tsx`,
      then `server/routers/quickTasks.test.ts` — each passing alone in under 40 s, before a fourth
      run went clean. The chapter-joining PR passed `check-all` locally and failed only in CI: two
      component tests acted before a query had loaded (a chapter deleted before the dialog listed
      it; a `getByText` on a list from a second query), which local timing always won.
      The dependency-lag rework's run hit `ProjectEditor.test.tsx` once more: Submit opens its
      dialog only after a fresh fetch, which outlasted `findByText`'s one-second default.
      The UI-consistency run hit `app/signup/page.test.tsx`: the resend request outlasted
      `vi.waitFor`'s one-second default under load, and the fake clock it left behind timed out
      every later test in the file, so one race read as ten failures.

## 7x

- [ ] **Two sessions running vitest at once share one test template database and one
      `coverage/` directory, so one run wipes the other's.** During P4-05 another agent's
      single-file reruns in the same checkout dropped `vitest_template` mid-run (about 70
      suites failed with "template database does not exist"), and the next full run refused to
      start on the coverage lock. In P4-14 a P4-07 agent's reruns of the task page test made
      four of five runs of the project page test fail with bare `PrismaClientKnownRequestError`s,
      and the full unit suite could not be run at all without breaking the other agent's. P4-07's
      own full run then failed 49 tests on "Database `vitest_…` does not exist" while P4-14's
      was going, and passed untouched once that had finished. P4-20's full run, with P4-19 and
      P4-12 agents in the same tree, first hit the coverage lock and then failed every suite on
      "Server has closed the connection", so its coverage was checked file by file instead.
      P4-19's two full runs, beside the same agents, failed 50-100 suites on
      `PrismaClientInitializationError` while every file passed alone (`--coverage.reportsDirectory`
      at least got past the lock). In Phase 6 even two agents' single-file runs of the project
      page test, against separate regions of it, dropped each other's databases repeatedly, so
      each waited for the other to finish before its tests counted. The dependency-lag rework, in
      its own worktree but against the same Postgres, waited for the other worktree's run to end
      and still lost 78 tests to "table … does not exist" when that worktree started again
      mid-run: `dropStale` drops every `vitest_` schema, not just its own run's. A per-run database prefix and reports directory in
      `test/pg.ts` and `scripts/test-unit.ts` (from an env var or the pid) would let runs overlap.

## 5x

- [ ] **`npm run new-migration` always writes an unrelated `ALTER TABLE "schema_migrations"`
      line that must be deleted by hand, and if `npm run migrate` runs first it is applied
      and recorded.** In R-08 a failed rename let migrate apply it; undoing it needed a
      hand-run `psql` from the owner, because editing an applied migration is blocked. P4-05's
      enum rename diff carried it again, and so did the national chapters migration, along
      with a `CREATE EXTENSION` already applied, and both duplicate-account migrations. The
      chapter-joining enum migration carried it too; running migrate before stripping it failed
      the migration and left it recorded as failed until `prisma migrate resolve`.
      `scripts/new-migration.ts` should strip both from the diff it writes.

## 4x

- [ ] **Component tests that remount a page as a different user read the previous user's
      cached query first, so a `getBy…` right after the remount sees stale data.** It cost
      a debugging round in R-06 and two more in R-08 (the owner's buttons, then the
      "waiting" count). P4-07's task page test found no Reopen button straight after
      remounting as the owner, and after reopening saw the old Done state come back. P4-11's
      timeline test, remounting after marking a task done in the database, still drew the
      not-done task's Plan menu until it called `queryClient.clear()`. A fourth hit: a
      task-helpers test mounting a third, then a fourth, viewer in the same test (no
      mutation between the third mount and the fourth, so nothing had invalidated the
      cache) rendered the third viewer's `canAddHelpers`/`eligibleHelpers` for the fourth —
      `findByRole` for a heading unchanged between the two views resolved instantly against
      the stale tree, so the race hid behind a passing assertion right up to the real one.
      `renderApp` could start each mount with an empty query cache, or `test/render.tsx`
      could say to use `findBy…` after a remount.

## 3x

- [ ] **A git worktree cannot run the suite until it has the main checkout's env files and a
      real `node_modules`.** Working beside another session's uncommitted changes, the unit tier
      failed with "DATABASE_URL is not set" until `.env`/`.env.local` were linked in, and the e2e
      build failed on a symlinked `node_modules` ("points out of the filesystem root") until it
      was cloned with `cp -cR`. An Orca worktree for the status-badge review had no
      `node_modules`, `generated/` or `.env` at all: typecheck needed `npm ci`, then
      `npm run generate` needed a dummy `DATABASE_URL`, `CHECKPOINT_DISABLE=1` and
      `node --import tsx` (the sandbox refuses tsx's IPC pipe), and no unit test could run. A
      `scripts/new-worktree.ts` that links the env files, clones `node_modules` and copies
      `generated/` would make a side worktree work first time. The dependency-lag rework's
      Claude worktree had no `.env.local` either, so `npm run generate` failed until it was copied.

## 2x

- [ ] **A `null`-target guard written for a dialog's confirm or dismiss handler
      is unreachable, and 100% statement coverage only says so after a full
      unit run.** Five confirm-dialog call sites, then the approval welcome's
      dismiss handler, each needed rewriting once the coverage gate rejected
      them, and a handler wired only to Escape or the close button stays
      uncovered until a test presses it. The pattern that has no unreachable
      line — render the dialog inside `{target && (…)}` and read the target in
      the handler closure — belongs in `AGENTS.md` next to the coverage rules,
      and in `components/ui/ConfirmDialog.tsx`'s own usage note.

- [ ] **There is no quick way to see coverage for just the files a change touched, so each
      uncovered line costs a full `check-all`.** Phase 3 needed four extra runs (about 7 minutes
      each) for single lines, and its UX-review follow-up a fifth (a hint's click handler): a cron registry wrapper, a dialog's error toast, an import path
      no test fed a new field, a chip's own null guard. An npm script that runs the unit tests
      with coverage limited to files changed since `main` and prints their uncovered lines would
      find these in a minute.

## 1x

- [ ] **Component tests count error toasts (`getAllByText(msg).length`), and a
      toast dismisses itself after 4 s, so the count never arrives when the
      full suite runs slowly.** `app/quick-tasks/page.test.tsx` failed that way
      in a `check-all` run and cost a second full run; the same pattern is in
      `app/projects/[id]/page.test.tsx` and `components/ProjectEditor.test.tsx`.
      A shared helper in `test/` that finds a toast by text, clicks its Dismiss
      and waits for it to go (the `expectNotFound` helper in the Quick Tasks
      test) would let each step wait for a toast of its own.
- [ ] **After a client-side redirect, `window.location` can still hold the old address
      while the new page first renders, and jsdom tests never show it.** A `useState`
      initializer that read `?notice=` passed every unit test and showed nothing in the
      browser; only an e2e run caught it. The one note on this sat in a comment inside
      `app/dashboard/page.tsx`. Reading query parameters through one hook
      (`lib/hooks/useOneTimeNotice.ts` reads on mount) and a line in `AGENTS.md` would stop
      the next page repeating it.
- [ ] **Seeded dev accounts are hidden from the directory, so they can't be
      invited to a project or sent a contact request.** `scripts/seed-dev-accounts.ts`
      sets `consent_make_profile_visible_in_directory` false, and the invite picker
      and Request contact both need it true; QA needed a hand-run `UPDATE`. The seed
      should set it true.

- [ ] **Seeded dev accounts hold no project roles, so a two-role browser drive (owner and
      assignee) starts with hand-run database edits.** The Phase 3 UX review spent several turns
      giving `volunteer@example.com` a task by `UPDATE`, then hit "Task not found" because the
      project is team- and country-scoped and a bare `assigneeId` grants no membership; a second
      volunteer had no session token because `SEED_VOLUNTEERS` defaults to 1. The seed could put
      each dev account on one live project (owner, deputy, assignee with an accepted interest and
      a matching country) and `CLAUDE.local.md` could say which project that is.

- [ ] **A hard navigation in the Claude-in-Chrome tab sometimes leaves the page unresponsive to
      the extension (screenshots and scripts time out for minutes) while the server and renderer
      are idle.** Three times in one review; each cost a tab-context reset and a fresh tab. A line
      in `CLAUDE.local.md` saying to prefer in-app links over `navigate` and to open a fresh tab
      after one timeout, rather than waiting or diagnosing the app, would save the detour.

- [ ] **Component tests that pin a calendar date but not "today" rot as the calendar passes
      them.** `task-dates-ui.test.tsx` failed the day its 17 Sept 2026 deadline fell behind the
      real date, though nothing about the component had changed. Tests of anything that compares
      to today should either take a fixed today (`vi.setSystemTime`) or use dates far ahead.

- [ ] **Component tests mount React in a `<div>`, but Next.js hydrates it at `document`, so
      `stopPropagation` in a React handler holds back a `document` listener in jsdom and not in
      the browser.** The owner popover's Remove row passed every unit test and did nothing in
      e2e `28`: the picker's outside-click listener on `document` closed the popover on mousedown,
      so the click never landed, and it took a debugging round to see why. `test/render.tsx`
      could mount into `document` (or `FilterDropdown` could take an "inside" ref), and a line in
      `AGENTS.md` could say not to rely on `stopPropagation` against `document` listeners.

- [ ] **The test template database is built from every migration, so it holds the rows a
      migration inserts: a UK chapter and local groups such as London that no test made.**
      Fixtures named after real places then hit unique constraints, and a volunteer signing up
      from the UK lands in that chapter, which cost two rounds of reading test failures in the
      national chapters work. `test/setup-db.ts` could empty those tables in the template, or
      `test/factories.ts` could say which rows are already there.

- [ ] **Load-dependent flaky unit tests surface one per `check-all`, so each costs a full
      five-minute run to find.** Three unrelated flakes (an unawaited notification in
      `quickTasks.submit`, a scratch-database drop timing out in `disposable-db.test.ts`, a
      `ProjectEditor` test clicking before its task saved) appeared on three successive runs and
      passed alone every time. The `ProjectEditor` one came back on a later run, and with half
      the cores busy other tests in that file failed too, on waits that assume a server round
      trip finishes within the default second. Reproducing needs load, and running test files
      side by side collides on the shared test-database setup, so the only way was busy-looping
      cores by hand. A script that runs the unit suite several times under load and lists every
      test that failed in any run would surface them together, and could run nightly.

- [ ] **`globals.css`'s hand-written element selectors (`h1`, `p`, `label`, …) sit outside any
      `@layer`, so — per the CSS cascade-layers spec — they always beat Tailwind's own utilities
      regardless of specificity; a per-instance override such as `className="mb-0"` on a raw
      `<h1>` was a silent no-op the whole time.** Extracting those selectors into components
      (issue #88) removes the unlayered rule, so every such override starts actually applying —
      correct, and the point of the extraction, but it reads as a wall of unrelated visual-diff
      noise (382 of 393 snapshots) with no CSS mistake behind any of it. Chasing it as a bug cost
      most of a session: a stale dev-server cache and an orca-sidecar-vs-published-port
      networking gap both looked like candidate causes before `getBoundingClientRect` in the
      actual Playwright run (not a manual dev-server poke) showed a `className="mb-8"` paragraph
      computing `margin-bottom: 12px` against the pre-extraction code and `32px` after — proof the
      override had never worked. `e2e/snapshots/README.md` or this issue's own description could
      say up front that a raw-tag extraction is expected to move pixels everywhere a conflicting
      override already existed in the markup, so the gallery diff is read as "does each
      now-active override look right" rather than "is this a regression."

- [ ] \*\*Many routers send email through a fire-and-forget promise (`sendX(...).catch(...)`,
      never awaited), so tests that check `emails.last`/`emails.lastTo` right after the action
      only passed because `lib/email.ts`'s template builders used to be synchronous — the
      `MemoryEmailTransport.send` push happened before the route handler's promise even settled.
      Making those builders genuinely async (the react-email migration, issue #158) turned every
      such assertion in `lib/notify.test.ts`, `server/routers/auth.test.ts`,
      `server/routers/messages.test.ts` and `server/routers/admin/applications.test.ts` into a
      deterministic failure, ten in one `check-all` run. Each needed wrapping in
      `await vi.waitFor(() => expect(...))`, same as the DB-state waits already next to them. A
      note in `test/fakes/email.ts` or `AGENTS.md`'s "Email in tests" section saying that a
      fire-and-forget send is never guaranteed landed by the time the triggering call resolves,
      and to wrap the assertion in `vi.waitFor` the way nearby DB checks already do, would save
      re-discovering this the next time anything in the send path gains a genuine await.

- [ ] **`npm run typecheck` skips `e2e/` (the root `tsconfig.json` excludes it), and
      `e2e/tsconfig.json` does not compile on its own (module resolution, implicit anys), so a
      broken import in an e2e helper only shows when Playwright runs that spec.** An edit to
      `e2e/actions/projects.ts` dropped `openProjectMore`; typecheck and lint passed, and the
      first sign was three failing specs ten minutes into `check-all`. Fixing `e2e/tsconfig.json`
      and running it from `typecheck` would have caught it in seconds.

- [ ] **Every worktree's e2e run starts its servers on the same ports (4000 up), so a
      `next-server` another worktree left behind fails global setup with "did not become
      ready within 30s".** The PWA work waited for the other worktree's Playwright to exit,
      then lost two runs to an orphan of its server still holding port 4004; only the server
      log in `tmp/e2e-server-4.log` said `EADDRINUSE`. Global setup checking the port is free
      before it starts a server, and naming the process that holds it, would make this a
      one-line diagnosis; a per-worktree port block would avoid it.

- [ ] **Snapshot pictures still hold values that differ every run, so a refactor compared
      against its base ref shows changed pictures with no code behind them.** The Tailwind theme
      audit's `--against` run reported 17 changed per desktop lane, and each had to be cropped
      against its baseline to dismiss: "Saved 10:49 AM" draft times, `Date.now()` suffixes in
      fake titles, API tokens, the inbox unread dot landing before or after the shot, and the
      roadmap's order of same-dated projects. The date rewrite before capture could cover clock
      times and epoch numbers, `e2e/fake.ts` could seed the suffixes, and the token page could
      mask its token.

- [ ] **A component test stalled on something that never resolves waits out the 60 s dom
      test timeout, so one broken shared component turned a 3-minute unit run into over ten.**
      A new hook batched requests with `setTimeout`, which a test's fake timers froze, and
      components rendered with a bare `render` threw for want of a `QueryClient`: dozens of
      tests sat for 60 s each before failing, and the run timed out before printing which.
      A dom `testTimeout` near the 20 s the node project uses, or a failing test reported as
      it fails rather than at the end, would have shown the cause in the first minute.

- [ ] **A session whose sandbox cannot reach Postgres cannot run a single unit test, pure ones
      included, so its only test signal is a CI run.** The role-based access work wrote its
      access-matrix tests blind, pushed them to a draft PR to prove them against the old code,
      and read the results from `gh api repos/PauseAI/catalyse/check-runs/<job id>/annotations`
      because `gh run view --log` downloads from a blob host the sandbox refuses. Even
      `lib/permissions.test.ts`, which touches no database, needed a hand-made vitest config,
      since every node test file runs `test/global-setup.ts`. A vitest project for tests that
      need no database, and a script that prints a CI run's failing tests from its annotations,
      would give such a session a loop of seconds for pure code and one readable command for the
      rest.
