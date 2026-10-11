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

## 4x

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
      before it showed as read). Each passed 8/8
      when run alone. A script that reruns one
      file under the same parallel load (for example all unit files at once with
      only the suspect repeated) would find them in one pass instead of one per
      full run.

## 3x

- [ ] **Two sessions running vitest at once share one test template database and one
      `coverage/` directory, so one run wipes the other's.** During P4-05 another agent's
      single-file reruns in the same checkout dropped `vitest_template` mid-run (about 70
      suites failed with "template database does not exist"), and the next full run refused to
      start on the coverage lock. In P4-14 a P4-07 agent's reruns of the task page test made
      four of five runs of the project page test fail with bare `PrismaClientKnownRequestError`s,
      and the full unit suite could not be run at all without breaking the other agent's. P4-07's
      own full run then failed 49 tests on "Database `vitest_…` does not exist" while P4-14's
      was going, and passed untouched once that had finished. A
      per-run database prefix and reports directory in `test/pg.ts` and `scripts/test-unit.ts`
      (from an env var or the pid) would let runs overlap.

- [ ] **Component tests that remount a page as a different user read the previous user's
      cached query first, so a `getBy…` right after the remount sees stale data.** It cost
      a debugging round in R-06 and two more in R-08 (the owner's buttons, then the
      "waiting" count). P4-07's task page test found no Reopen button straight after
      remounting as the owner, and after reopening saw the old Done state come back. P4-11's
      timeline test, remounting after marking a task done in the database, still drew the
      not-done task's Plan menu until it called `queryClient.clear()`.
      `renderApp` could start each mount with an empty query cache, or `test/render.tsx`
      could say to use `findBy…` after a remount.

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

- [ ] **`npm run new-migration` always writes an unrelated `ALTER TABLE "schema_migrations"`
      line that must be deleted by hand, and if `npm run migrate` runs first it is applied
      and recorded.** In R-08 a failed rename let migrate apply it; undoing it needed a
      hand-run `psql` from the owner, because editing an applied migration is blocked. P4-05's
      enum rename diff carried it again. `scripts/new-migration.ts` should strip that
      statement from the diff it writes.

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

- [ ] **A git worktree cannot run the suite until it has the main checkout's env files and a
      real `node_modules`.** Working beside another session's uncommitted changes, the unit tier
      failed with "DATABASE_URL is not set" until `.env`/`.env.local` were linked in, and the e2e
      build failed on a symlinked `node_modules` ("points out of the filesystem root") until it
      was cloned with `cp -cR`. A `scripts/new-worktree.ts` that links the env files, clones
      `node_modules` and copies `generated/` would make a side worktree work first time.
