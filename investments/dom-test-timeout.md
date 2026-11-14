# A stalled component test waits out a 60 s timeout

Size: S. Kind: small fix.

## Problem

The dom vitest project's `testTimeout` is 60 s, so when a shared component breaks, dozens of tests each sit for a minute before failing, and the run can time out before printing which.

## Fix

A dom `testTimeout` near the node project's 20 s, or failures reported as they happen rather than at the end.

## Hits

- 2026-10-26: a hook batching with `setTimeout` under fake timers, and components rendered without a `QueryClient`, turned a 3-minute unit run into over ten
