# `window.location` can hold the old address while a redirected page first renders

Size: S. Kind: small fix.

## Problem

After a client-side redirect, `window.location` can still hold the old address during the new page's first render, and jsdom tests never show it. A `useState` initializer that read `?notice=` passed every unit test and showed nothing in the browser; only an e2e run caught it. The one note on this is a comment in `app/dashboard/page.tsx`.

## Fix

Read one-time query parameters through one hook (`lib/hooks/useOneTimeNotice.ts` reads on mount), and add a line to `AGENTS.md` saying so.

## Hits

- 2026-09-23: the dashboard's `?notice=` showed nothing in the browser, found only by e2e
