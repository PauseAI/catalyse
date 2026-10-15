# Catalyse

**Volunteer & Project Matching Platform for PauseAI**

Catalyse connects volunteers with projects, matching skills to needs and enabling effective coordination across PauseAI initiatives.

## Features

### For Volunteers

- **Browse Projects** - Filter by skills, status, urgency
- **Skill Matching** - See how well your skills match each project
- **Express Interest** - Apply to contribute or lead projects
- **Personal Dashboard** - Track your projects and interests
- **Privacy Controls** - Choose what info to share and how

### For Project Owners

- **Post Projects** - Describe needs, required skills, time commitment
- **Find Volunteers** - See interested volunteers and their skills
- **Team Communication** - Contact volunteers through the platform

### For Admins

- **Project Triage** - Review and approve volunteer proposals
- **Create Org Projects** - Post official PauseAI initiatives
- **Platform Stats** - Monitor volunteer and project activity

## Tech Stack

- **Frontend**: Next.js (App Router), React, TypeScript, Tailwind CSS
- **Backend**: Next.js API routes
- **Database**: PostgreSQL via Prisma ORM
- **Email**: Resend SDK
- **Auth**: Custom token-based + Google OAuth
- **Hosting**: Railway

## Getting Started

### Prerequisites

- Node.js 22+
- npm
- A PostgreSQL 18 server. `docker compose up -d` starts one matching CI and production; a
  native install (Homebrew, apt, Postgres.app) works too — set `DATABASE_URL` accordingly.
  `pg_dump`/`pg_restore` are needed for `fetch-prod-db` and the backup job; `local-setup`
  installs them if missing (`npm run install:pg-tools`: Homebrew on macOS, apt/dnf/pacman/apk on Linux).

### Installation

```bash
npm run local-setup
```

This installs dependencies, Playwright browsers and the Postgres client tools, restores a copy of production into your database (anonymised), and runs migrations. Postgres must be running first.

### Environment

Copy `.env.local.example` to `.env.local` and fill in the values:

```bash
cp .env.local.example .env.local
```

Key variables:

- `DATABASE_URL` — Postgres connection URL (e.g. `postgresql://postgres:postgres@localhost:5432/catalyse`)
- `RESEND_API_KEY` — for email sending
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — for Google OAuth
- `STUB_EMAIL=true` — suppress real emails in development

### Running

```bash
npm run dev
```

The app will be available at `http://localhost:3000`.

### First-Time Setup

To make yourself an admin, add your email to `.env.local`:

```env
ADMIN_EMAILS=your@email.com
```

On next login, the app will automatically grant admin access. Multiple emails can be comma-separated.

## Database & Migrations

### Local dev database

The local dev database is a copy of prod, restored into whatever `DATABASE_URL` points at. Refresh it with:

```bash
npm run fetch-prod-db && npm run migrate
```

`fetch-prod-db` downloads the latest prod `pg_dump` from B2, **drops and recreates the `public` schema** of the target database, and restores into it. It then runs the same scrub as `anonymise-db` (PII replaced, dev accounts seeded) and empties the database again if that fails, so raw prod data is never left behind. Every account gets the same known password, so an anonymised copy must not sit behind a public URL. `anonymise-db` alone re-scrubs a database that is already restored. `scripts/anonymise-columns.ts` records how each text column is treated, and a test fails when a new column is missing from it. Both scripts refuse to run when `RAILWAY_ENVIRONMENT_NAME=production`, and `fetch-prod-db` refuses in any Railway environment unless `ALLOW_DB_RESTORE=1` is set (set it only on the preview base environment). `migrate` runs `prisma migrate deploy`, which applies any unapplied migration files in order without drift-checking.

Each unit test file gets its own copy of the schema (`vitest_*`), made either by cloning a template database migrated once per run (`TEST_DB_MODE=clone`, needs a role with `CREATEDB`) or by replaying the migrations into a schema (`TEST_DB_MODE=schema`). Cloning is faster only on the `db-test` server, so the default is `clone` when `TEST_DATABASE_URL` is set and `schema` otherwise. E2E workers use the schemas `e2e_<n>`. Both go to `TEST_DATABASE_URL` when set, else `DATABASE_URL`; neither touches `public` of your dev data. `docker compose up -d` also starts `db-test` on port 5433, an in-memory Postgres with durability off that is only safe because it holds nothing but test data. Set `TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/catalyse_test` in `.env.local` to use it.

Both suites default to half the cores. Tune them with `VITEST_MAX_WORKERS` and `WORKER_COUNT` in `.env.local`, and find a good count for a machine with `npx tsx scripts/tune-workers.ts unit 3 4 5 6`.

### Adding a migration

Do **not** use `prisma migrate dev` — it checks for schema drift against the live DB and will fail. The correct workflow:

1. Edit `prisma/schema.prisma`
2. Generate the migration file:
   ```bash
   npm run new-migration your_migration_name
   ```
   This creates `prisma/migrations/YYYYMMDDHHMMSS_your_migration_name/migration.sql` with the diff SQL.
3. **Review the generated SQL** — the diff may include unrelated pending changes from other branches. Remove any statements not relevant to your change.
4. Apply it:
   ```bash
   npm run migrate
   ```
5. Regenerate the Prisma client:
   ```bash
   npx prisma generate
   ```

## Maintenance mode

Super admins can take the site down from **Admin → Platform Settings → Maintenance mode**. Everyone else then sees a "down for maintenance" page and every API call except signing in or out is refused with a 503. Super admins (emails in `ADMIN_EMAILS`) can still log in at `/login` and use the whole site as normal, with a banner at the top of every page reminding them it is on; switch the toggle off there to bring the site back.

## Testing

### Running tests

```bash
npm run test:unit       # Run unit tests only (vitest)
npm run test:e2e        # Run e2e tests only (Playwright)
npm run test:e2e:headed # Run with a visible browser (single worker, slowed)
npm run test:e2e:ui     # Open Playwright UI mode
npm run snapshots       # Photograph every e2e test and build a visual diff gallery (see e2e/snapshots/README.md)
```

Tests spin up an isolated Next.js server with a fresh database — your dev server doesn't need to be running.

The `test:e2e:dev` variants skip the build and use a dev server instead. These are for interactive development only — do not use them to verify correctness, as they skip type checking and build validation.

### CI workflow checks

The repo is public, so pull requests from forks run `.github/workflows/ci.yml` with untrusted code. GitHub gives such runs a read-only token and no repository secrets; the workflow is written so it never needs either, and two checks keep it that way:

- **[zizmor](https://docs.zizmor.sh/)** runs in the `static-checks` job and fails on dangerous triggers, template injection, unpinned actions, broad permissions and leaked credentials. Run it locally with `uvx zizmor .github/workflows/` (needs [uv](https://docs.astral.sh/uv/)).
- **`test/ci-workflow.test.ts`** (part of `npm run test:unit`) checks the project-specific rules zizmor can't know: only `push`/`pull_request` triggers, no `secrets.*` anywhere, read-only permissions, GitHub-hosted runners, every `*_URL` pointing at `localhost`, and every credential-shaped variable holding a literal dummy.

Actions are pinned to commit SHAs with the version in a trailing comment; bump both together.

## Scripts Reference

| Script             | Description                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `local-setup`      | One-time local setup: install deps, browsers, Postgres client tools, fetch prod DB (anonymised), run migrations                                 |
| `issue <number>`   | Launch a sandboxed Claude session to work on a GitHub issue (creates branch, fetches issue, restricts CLI access). Usage: `npm run issue -- 84` |
| `check-all`        | Run typecheck, lint, format check, and tests — use before committing                                                                            |
| `dev`              | Start local dev server with Turbopack                                                                                                           |
| `build`            | Generate Prisma client and run Next.js production build                                                                                         |
| `start`            | Start production server (requires prior `build`)                                                                                                |
| `typecheck`        | Run TypeScript type checking without emitting files                                                                                             |
| `lint`             | Run ESLint                                                                                                                                      |
| `lint:fix`         | Run ESLint with auto-fix                                                                                                                        |
| `format`           | Format all files with Prettier                                                                                                                  |
| `format:check`     | Check formatting without writing                                                                                                                |
| `generate`         | Regenerate Prisma client and run post-generation script                                                                                         |
| `build:railway`    | Production build entrypoint used by Railway CI                                                                                                  |
| `new-migration`    | Create a new migration SQL file from schema diff                                                                                                |
| `migrate`          | Apply pending migration files to the local database                                                                                             |
| `fetch-prod-db`    | Restore latest prod backup into DATABASE_URL, anonymised, with dev accounts seeded                                                              |
| `anonymise-db`     | Anonymise PII in DATABASE_URL and seed dev accounts                                                                                             |
| `install:browsers` | Install Playwright's Chromium browser                                                                                                           |
| `test:unit`        | Run unit tests with vitest                                                                                                                      |
| `test:unit:watch`  | Run vitest in watch mode                                                                                                                        |
| `test:e2e`         | Run all e2e tests (builds first, then spins up isolated servers)                                                                                |
| `test:e2e:dev`     | Run e2e tests against a dev server — skips build, for interactive development only                                                              |
| `test:e2e:log`     | Run e2e tests and save full output to `test-output.txt`                                                                                         |
| `test:e2e:headed`  | Run e2e tests with a visible browser, single worker                                                                                             |
| `test:e2e:ui`      | Open Playwright UI mode for interactive test debugging                                                                                          |
| `snapshots`        | Run the e2e suite with every test photographed and build `snapshots/index.html`, a visual diff gallery; see `e2e/snapshots/README.md`           |
| `cron:backup`      | Run the database backup cron job                                                                                                                |
| `demo`             | Run the demo data seeding script                                                                                                                |
| `demo:snapshot`    | Take a snapshot of the current demo state                                                                                                       |
| `demo:compare`     | Compare current demo state against snapshot                                                                                                     |

## Project Structure

```text
catalyse/
├── app/                    # App Router pages and API routes
├── components/             # Shared React components
├── lib/                    # Auth, email, Prisma, utilities
├── prisma/                 # Prisma schema and migrations
├── public/                 # Static assets
├── scripts/                # Build and utility scripts
└── e2e/                    # Playwright end-to-end tests
```

`AGENTS.md` holds the working notes for coding agents and contributors, and
`SELF-IMPROVE.md` is the backlog of things about the repo itself that made work
harder than it needed to be, sorted by how often each has bitten.

## License

MIT - Built for PauseAI
