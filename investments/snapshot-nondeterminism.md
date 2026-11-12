# Snapshot pictures hold values that differ every run

Size: S. Kind: tools.

## Problem

Clock times ("Saved 10:49 AM"), `Date.now()` suffixes in fake titles, API tokens, the inbox unread dot landing before or after the shot, and the order of same-dated roadmap projects all differ run to run, so an `--against` comparison shows changed pictures with no code behind them.

## Fix

The date rewrite before capture covers clock times and epoch numbers, `e2e/fake.ts` seeds the suffixes, and the token page masks its token.

## Hits

- 2026-10-26: the Tailwind theme audit's `--against` run reported 17 changed pictures per desktop lane, each cropped against its baseline to dismiss
