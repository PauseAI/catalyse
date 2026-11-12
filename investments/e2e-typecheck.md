# `npm run typecheck` skips `e2e/`

Size: S. Kind: small fix.

## Problem

The root `tsconfig.json` excludes `e2e/`, and `e2e/tsconfig.json` doesn't compile on its own (module resolution, implicit anys), so a broken import in an e2e helper shows only when Playwright runs that spec.

## Fix

Fix `e2e/tsconfig.json` and run it from `typecheck`.

## Hits

- 2026-10-23: an edit to `e2e/actions/projects.ts` dropped `openProjectMore`; typecheck and lint passed, and three specs failed ten minutes into `check-all`
