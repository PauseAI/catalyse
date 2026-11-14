# A hard navigation can leave the Claude-in-Chrome tab unresponsive

Size: S. Kind: ways of working.

## Problem

After a hard navigation, the Claude-in-Chrome tab sometimes stops answering the extension (screenshots and scripts time out for minutes) while the server and renderer are idle, and it looks like an app problem.

## Fix

A line in `CLAUDE.local.md`: prefer in-app links over `navigate`, and open a fresh tab after one timeout rather than waiting or diagnosing the app.

## Hits

- 2026-10-15: three hangs in one review, each costing a tab-context reset and a fresh tab
