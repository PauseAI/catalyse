# Component tests mount React in a `<div>`, but Next.js hydrates at `document`

Size: S. Kind: small fix.

## Problem

In jsdom, `stopPropagation` in a React handler holds back a `document` listener; in the browser it doesn't, because Next.js's root is `document`. A click that works in unit tests can do nothing in the real app.

## Fix

`test/render.tsx` mounts into `document` (or `FilterDropdown` takes an "inside" ref), and `AGENTS.md` says not to rely on `stopPropagation` against `document` listeners.

## Hits

- 2026-10-15: the owner popover's Remove row passed every unit test and did nothing in e2e `28`, because the picker's outside-click listener closed the popover on mousedown; a debugging round to see why
