# The test template database holds rows that migrations insert

Size: S. Kind: small fix.

## Problem

The template is built from every migration, so it holds a UK chapter and local groups such as London that no test made. Fixtures named after real places hit unique constraints, and a volunteer signing up from the UK lands in that chapter.

## Fix

`test/setup-db.ts` empties those tables in the template, or `test/factories.ts` says which rows are already there.

## Hits

- 2026-10-16: two rounds of reading test failures in the national chapters work
