# Seeded dev accounts hold no project roles

Size: S. Kind: tools.

## Problem

A browser check that needs two roles on one project (owner and assignee) starts with hand-run database edits. Projects are team- and country-scoped, so a bare `assigneeId` grants no membership ("Task not found"), and `SEED_VOLUNTEERS` defaults to 1, so a second volunteer has no session token.

## Fix

The seed puts each dev account on one live project (owner, deputy, assignee with an accepted interest and a matching country), and `CLAUDE.local.md` says which project that is.

## Hits

- 2026-10-15: the Phase 3 UX review spent several turns giving a volunteer a task by `UPDATE`, then hit "Task not found"
