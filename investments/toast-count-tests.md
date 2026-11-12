# Component tests count error toasts that dismiss themselves

Size: S. Kind: small fix.

## Problem

Tests that count error toasts (`getAllByText(msg).length`) race the toast's 4 s self-dismissal, so the count never arrives when the full suite runs slowly. The pattern is in `app/quick-tasks/page.test.tsx`, `app/projects/[id]/page.test.tsx` and `components/ProjectEditor.test.tsx`.

## Fix

A shared helper in `test/` that finds a toast by text, clicks its Dismiss and waits for it to go (as `expectNotFound` in the Quick Tasks test does), so each step waits for a toast of its own.

## Hits

- 2026-09-23: `app/quick-tasks/page.test.tsx` failed this way in `check-all` and cost a second full run
