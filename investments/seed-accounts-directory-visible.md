# Seeded dev accounts are hidden from the directory

Size: S. Kind: small fix.

## Problem

`scripts/seed-dev-accounts.ts` sets `consent_make_profile_visible_in_directory` false, and the invite picker and Request contact both need it true, so seeded accounts can't be invited to a project or sent a contact request.

## Fix

The seed sets it true.

## Hits

- 2026-09-24: QA needed a hand-run `UPDATE`
