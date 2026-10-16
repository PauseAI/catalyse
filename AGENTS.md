<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Database migrations

Do **not** run `prisma migrate dev` — it checks for schema drift and will fail. To add a migration:

1. Edit `prisma/schema.prisma`
2. `npm run new-migration your_migration_name` — generates the SQL diff file
3. Review the generated SQL and remove any unrelated statements
   - Adding a `NOT NULL` column with no default: the diff adds it as `NOT NULL` straight away, which fails on a table with rows. Add it nullable, backfill it, then `SET NOT NULL`, all in the same migration.
   - Only what `schema.prisma` can express survives: the next `new-migration` diffs the database against the schema and drops any index or constraint written by hand, such as a partial unique index.
4. `npm run migrate` — applies it
5. `npm run generate` — regenerates the client and zod schema

## Disposable databases

`fetch-prod-db`, `anonymise-db` and the dev-account seed refuse any database not marked disposable (`scripts/disposable-db.ts`); production never is. An empty database is marked on its first restore; mark an existing local one with `npm run mark-disposable`. Never mark a database that holds data you need.

## Verifying changes

Run `npm run check-all` when work is complete and before raising a PR, to verify typecheck, lint, formatting, and tests all pass. This takes several minutes — lint is ~3s cached (~70s cold), tests are ~2.5–3 min. Do not abort early.

## Signing in to the dev server

To check a change in a browser as a particular user, never type a password. Every seeded dev account has a session token, `dev-` plus its email's local part, and signs in on its own localhost subdomain of the same name:

- `volunteer@example.com` → http://volunteer.localhost:3000, token `dev-volunteer`
- `lead@example.com` → http://lead.localhost:3000, token `dev-lead`
- `admin1@example.com` → http://admin1.localhost:3000, token `dev-admin1`

Who can do what is decided by national chapter (`lib/chapter-access.ts`). Volunteers and deputies are in the UK chapter; `lead@` leads it, and `lead1@`, `lead2@` … lead Germany, France and on, so a second chapter is there to try. `admin@` and `superadmin@` are global admins only while their addresses are in `ADMIN_EMAILS`.

Sessions live in per-origin `localStorage`, so each subdomain holds its own, and several roles can be open side by side. Use an unseeded subdomain (`anon.localhost:3000`) for signed-out views. To sign one in, open its `/login` page and run `localStorage.setItem('authToken', 'dev-admin'); location.href = '/dashboard'`. On any other page, a stale token's 401 clears storage straight after your write.

`seedDevAccounts` (`scripts/seed-dev-accounts.ts`) seeds the tokens on every `fetch-prod-db` / `anonymise-db`, into local databases only, so a signed-in subdomain stays signed in across reseeds. `SEED_VOLUNTEERS` / `SEED_LEADS` / `SEED_DEPUTIES` / `SEED_ADMINS` / `SEED_SUPERADMINS` set how many accounts of each role exist (default 1). For a scenario needing more people (owner, assignee), give seeded volunteers those roles in the app.

If `format:check` fails, run `npm run format` to fix all files at once — do not run `prettier --write` on individual files.

## Comments

Comments describe the code as it stands — never the edit, never a measurement, never twice. The reader holds none of your context: not what the code looked like before, not what you rejected, not what a run reported last week. Check every comment against these four failures before committing:

- **Describing the edit.** "now", "no longer", "as before"; "rather than X" where X is what the code used to do; "without a tiebreak of its own"; "the one test covers both". If the previous version of the file is needed for the comment to make sense, the comment fails.
- **A number that will rot.** "a fifth of the platform's mutants", "1790 of 1880 tests", "roughly thirty survivors". True once, wrong soon. Write the durable version — "the map is large and stands apart" — and put the measurement in the commit message, which carries its own date.
- **Saying it seven times.** One explanation copied to every call site is seven things that must stay true. Say it once where you define the thing; at the other sites one line naming it is enough.
- **Excessive length.** Don't spread over three lines what one says. Every line costs the reader time, and they skip a long comment whole, including the part that mattered. Cut until only what they could not have worked out remains.

## Flaky tests

If a test fails once and passes on rerun, treat that as a bug to fix now, not noise: rerun that
test file 8 times, find the race, fix it, and rerun 8 times again until every run passes. The
usual cause is asserting on the database or a fetched value while the UI still shows stale data,
or waiting for one network response when several were fired. Wait for the UI state the next step
depends on (a button appearing, a row re-rendering), not for a side effect of it. Fold the fix
into whatever you are already working on.

## Testing and coverage

`npm run test:unit` runs vitest with coverage; CI fails below 100% line and statement coverage for `app/**`, `components/**`, `lib/**` and `server/**` (branch coverage will follow). Coverage is a floor on what is exercised, not a licence to reshape code:

- **Never** use `/* v8 ignore */`, `/* istanbul ignore */` or any coverage-exclusion comment.
- Don't remove a defensive guard, or replace it with a `!` non-null assertion, to make an unreachable line disappear. Reach it with a test (a form submits on Enter even when the button is disabled; a database row can hold what the API refuses; an evicted cache entry is a real state), or narrow the type at the call site so the guard is unnecessary. If a line genuinely cannot execute, say so in the PR so a reviewer can decide.
- Router tests run against a real per-file Postgres database, cloned from a template (`test/setup-db.ts`); component tests render in jsdom with `fetch` routed into the real oRPC handler (`test/setup-dom.ts`). Prefer these over mocking modules: the database and routers are always real.
- `env` (`lib/env.ts`) reads `process.env` on every access, so a test sets a variable with `vi.stubEnv` and calls the code under test directly. Don't copy an `env` value into a module-level constant; read it where it is used.

### Faking the outside world

Only the network edge is faked — email, Google token verification, rate limiting, third-party APIs — and the fake is an explicit seam in the production code, not a `vi.mock` of one of our own modules:

- **Make the code take the dependency, then hand it a fake.** A class or function that talks to the outside world is given its client or transport (a constructor parameter with a production default, or a `setX()` on a process-wide instance), and the test passes a fake. `lib/email-transport.ts` is the pattern: `EmailTransport` is abstract, the real implementations are chosen from the environment in one factory, and `setEmailTransport` swaps in `MemoryEmailTransport` from `test/fakes/email.ts`.
- **Fakes live in `test/fakes/` with named helpers.** A test reads `emails.failNext()` or `emails.lastTo(addr)`, so its intent is visible without inferring it from a mock block. The harness installs the shared fakes and resets them before each test; a test that needs a different one swaps it in and restores it in `afterEach`.
- **`vi.mock` is a last resort**, for a third-party module with no seam of its own or for `next/*` framework edges. If you find yourself mocking a module under `lib/` or `server/`, add a seam to it instead.
- **Assert on what would have reached the outside world**, not on which internal function was called: the recipient and rendered body of an email, the request a client was given.

### Email in tests

Every unit test file gets `emails`, a `MemoryEmailTransport` from `test/fakes/email.ts`, emptied before each test. The real templates run; only delivery is captured.

- **Assert on the sent email**: `emails.last` (the most recent), `emails.lastTo(address)` (most recent to one recipient — use this when other mail, such as admin alerts, may land in the same action), `emails.to(address)`, or `emails.sent` for the whole outbox. Check `to`, `subject` and that `html` contains what the user would read; name subjects once in a `subjects` map at the top of the file.
- **Tokens in links**: `linkParam(email, 'token')` reads a query parameter out of the body, so a test signs in or verifies with the link the user would actually have received rather than a value smuggled through a mock.
- **Failures**: `emails.failNext()` makes the next send throw (`failNext(n)` for several, `failAll()` for the rest of the test); `emails.setConfigured(false)` makes `isEmailConfigured()` false so the code takes its no-email path.
- **Fire-and-forget sends** happen after the response, so wrap those assertions in `vi.waitFor`.
- **Transport code itself** (`lib/email-transport.ts`) is tested by constructing each transport directly; `ResendTransport` takes a fake client as its second argument.

The same shape serves the other seams: `google.accept(credential, account)` (`test/fakes/google.ts`) makes a Google credential verify; `rateLimit.denyNext(retryAfterMs)` (`test/fakes/rate-limit.ts`) refuses the next rate-limited request; `cronJobs.returns(name, value)` / `cronJobs.fails(name, message)` (`test/fakes/cron-jobs.ts`) decide what a scheduled job does when a route or admin action runs it.

## Self improvement

After a medium to large task, review whether anything systemic made it hard or
slow: code structure, missing tools, infrastructure, documentation, errors and
diagnostics, a command too noisy for the context window, or information the user
could have given up front. Record what you find in `SELF-IMPROVE.md`, following
the rules at the top of that file. It has to have caused substantial confusion or
extra turns, and it has to look likely to recur on other tasks. Where the list
already holds the problem, increase its count (`1x` → `2x`) and reorder the list
so the largest number comes first.

`SELF-IMPROVE.md` always travels with the commit. Whatever it says when you
commit goes in with it, including edits you never made and edits about something
else entirely. It is the human's working notes as much as yours, so leaving a
change of theirs behind strands it there until whatever you commit next. Never
split it into a commit of its own, and never leave it out for being unrelated.

## End-to-end tests

`npm run test:e2e` drives a production build in a real browser, four workers each with its own server and Postgres schema (`e2e/`). The unit suite proves lines execute; this suite proves flows work, and it is the only place a page is rendered by the real Next server, routed, hydrated and clicked.

- **A user-facing flow gets a happy-path test here**: a page, a dialog, a form that saves, a status transition, a permission boundary. Add it to the spec that owns the area (`e2e/tests/NN-*.spec.ts`) or start a new numbered spec for a new area. Sprinkle the error paths a user can reach: a refused save, a validation message, a page that turns them away.
- **Drive the real UI the way a person would** with role and label locators, and assert on what they would see. Set up state through the API client (`e2e/client.ts`) where the flow being tested is not the setup; `e2e/actions/` holds the shared steps.
- **A test that never opens a page is not an e2e test.** A rule the API enforces, a permission check, what a router returns: those belong in `server/routers/*.test.ts`, which runs against the same real Postgres and is fifty times faster. Reserve this suite for what only a browser and a running server can show. The two exceptions are a Next route being served and a value built from the server's own environment.
- **Tests share a schema with the rest of their worker**, so assert on what this test made, never on the world being empty: the row it created leaves the list, not the list is empty. Fake data comes from `e2e/fake.ts` and is seeded per test, so a title is the same every run and different for every test; do not rely on `--repeat-each`, which reuses a seed.
- **Failures print Playwright's call log**; read it before the component. "Resolved, then detached" means the step before changed the screen; "never resolved" means the markup moved or the action did nothing.

## Visual snapshots

`npm run snapshots` runs the e2e suite with every test photographed, in four lanes (desktop and mobile, light and dark), and writes `snapshots/index.html`: each picture beside the one the previous run took, with changed pixels in red. Full guide: `e2e/snapshots/README.md`.

- **Run it when a change can move pixels**: a component, a stylesheet, a layout, a page's data. `npm run check-all` does not include it. Narrow it while iterating (`npm run snapshots -- e2e/tests/11-dashboard.spec.ts`, `-- --grep "marks all notifications as read"` for one test by title, `-- --project=mobile-dark`); a spec in one lane takes seconds; the whole suite runs every lane at once on a worker pool sized to the machine. Read the gallery, not only the terminal: a run that exits zero can still have changed a picture you did not mean to change.
- **Look at the pictures, not just the diff.** While working on a screen, capture the spec that reaches it and open the PNG under `snapshots/current/` (or the row in the gallery) to check the result looks right, on mobile and in dark mode as well as desktop light. Do this before calling UI work done: the diff says what moved, and only the picture says whether it should have.
- **Check uncommitted work against a ref in two runs**: `npm run snapshots -- --against=main` captures main and pins it as the baseline; a plain `npm run snapshots` then diffs your tree against it. `--clear-baseline` drops the pin.
- **A new user-facing flow gets a picture.** Every test's final frame is captured on its own. For the state in the middle (a dialog open, validation errors showing), call the `snap` fixture: `await snap(page, 'edit dialog open')`. Label the state, not the step. `snap` is a no-op in a plain `npm run test:e2e`.
- **Keep the picture deterministic.** Fake data is seeded per test, dates are rewritten before the shot, and the page must hold still. A capture reported as **unsettled** holds something that never stops moving; fix that rather than re-running. Don't put a wall-clock value, a random choice or a live counter in a screen without a way to hold it.
- **A red mark or count means pixels changed against the previous capture of that test.** The first run after a change to the capture machinery itself marks many rows; run again and they clear. A picture with nothing to compare against is **New**, and is not counted.
- **Compare with the sidecar, never by hashing the PNG**: `diffPixels` and `diff` in each capture's `.json` are the comparison the gallery uses.
- Commit nothing under `snapshots/`. Nothing in CI runs this yet; it is a local tool.
