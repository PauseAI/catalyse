# A headless screenshot can't sign in as a dev account

Size: S. Kind: tools.

## Problem

Signing in as a seeded dev account means running `localStorage.setItem` in the page, which a screenshot tool that only clicks, fills and navigates (the pod's `shot`) can't do. A screenshot of a signed-in page meant dropping a throwaway HTML file into `public/` to set the token and redirect, then deleting it.

## Fix

A development-only route that takes a `dev-` token, stores it and redirects, refused outside `NODE_ENV=development`, so any signed-in page is one URL away.

## Hits

- 2026-11-11 (x2): screenshots for two features each needed the throwaway page
