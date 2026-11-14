# A component test remounted as another user reads the previous user's cache

Size: S. Kind: small fix.

## Problem

`renderApp` keeps the query cache across mounts, so a page remounted as a different user first renders the previous user's data, and a `getBy…` straight after the remount sees it. A `findBy…` for something the two views share resolves at once against the stale tree, so the race hides behind a passing assertion until the real one.

## Fix

`renderApp` (`test/render.tsx`) starts each mount with an empty query cache, or at least says to use `findBy…` after a remount.

## Hits

- 2026-09-24: a debugging round in R-06 and two in R-08 (the owner's buttons, then the "waiting" count)
- 2026-10-15 (x3): P4-07's task page found no Reopen button after remounting as the owner, then saw the old Done state come back; P4-11's timeline drew the not-done task's Plan menu until `queryClient.clear()`; a task-helpers test's fourth viewer rendered the third viewer's `canAddHelpers`/`eligibleHelpers`
