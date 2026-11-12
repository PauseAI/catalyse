# `npm run new-migration` writes statements that must be deleted by hand

Size: S. Kind: small fix.

## Problem

`npm run new-migration` always writes an unrelated `ALTER TABLE "schema_migrations"` line, and often a `CREATE EXTENSION` already applied. If `npm run migrate` runs before they're stripped, the migration fails and stays recorded as failed until `prisma migrate resolve --rolled-back`, or is applied and recorded, and an applied migration can't be edited.

## Fix

`scripts/new-migration.ts` strips both statements from the diff it writes.

## Hits

- 2026-09-24: R-08's failed rename let migrate apply it; undoing it needed a hand-run `psql` from the owner
- 2026-10-15: P4-05's enum rename diff carried it
- 2026-10-16: the national chapters migration carried it, with a `CREATE EXTENSION` already applied
- 2026-10-17 (x2): both duplicate-account migrations carried it; the chapter-joining enum migration was run before stripping and left recorded as failed
- 2026-11-11: the call dismissals migration carried both; a chained `new-migration && migrate` failed the same way
