# Extracting unlayered element styles moves pixels wherever an override was silently ignored

Size: S. Kind: small fix.

## Problem

Element selectors written outside any `@layer` beat Tailwind's utilities regardless of specificity, so an override such as `className="mb-0"` on a raw `<h1>` was a no-op. Moving such a rule into a component makes every such override apply at once: correct, but it reads as a wall of unrelated visual-diff noise.

## Fix

`e2e/snapshots/README.md` says that removing an unlayered rule is expected to move pixels wherever a conflicting override already sat in the markup, so the gallery is read as "does each now-active override look right", not "is this a regression".

## Hits

- 2026-10-20: the `globals.css` extraction changed 382 of 393 snapshots; chasing it as a bug cost most of a session until `getBoundingClientRect` in the Playwright run showed a `mb-8` paragraph computing 12px before and 32px after
