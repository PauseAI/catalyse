# Tests that pin a date but not "today" rot as the calendar passes them

Size: S. Kind: small fix.

## Problem

A component test with a fixed calendar date compared against the real today fails the day that date falls behind, though nothing changed.

## Fix

Tests of anything compared to today take a fixed today (`vi.setSystemTime`) or use dates far ahead; a line in `AGENTS.md` under Testing says so.

## Hits

- 2026-10-15: `task-dates-ui.test.tsx` failed the day its 17 Sept 2026 deadline passed
