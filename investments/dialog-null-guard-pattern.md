# A null-target guard in a dialog's handler is unreachable and fails coverage

Size: S. Kind: small fix.

## Problem

A confirm or dismiss handler that starts `if (!target) return` has a line no test can reach, and the 100% statement gate only says so after a full unit run. A handler wired only to Escape or the close button stays uncovered until a test presses it.

## Fix

Write down the pattern with no unreachable line: render the dialog inside `{target && (…)}` and read the target in the handler's closure. It goes in `AGENTS.md` beside the coverage rules and in `components/ui/ConfirmDialog.tsx`'s usage note.

## Hits

- 2026-09-23 (x2): five confirm-dialog call sites, then the approval welcome's dismiss handler, each rewritten after the coverage gate rejected them
