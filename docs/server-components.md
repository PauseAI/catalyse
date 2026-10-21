# Server and client components

Almost every page under `app/` is a client component (`'use client'`). This note says what
a server component can and cannot do here, the pattern to follow when converting a page, and
which pages are worth it. `app/privacy/page.tsx` is the worked example.

## The constraint: the server does not know who is looking

A session is a bearer token in the browser's `localStorage` (`lib/auth-context.tsx`), sent as
an `Authorization` header by the oRPC client (`lib/client.ts`). Nothing about it reaches the server with a page
request: no cookie, no header. So every server render, of every page, is a render for an
anonymous visitor, whoever is actually signed in.

Two rules follow:

1. **A server component may render only what an anonymous visitor may see.** Everything
   else is a client island that fetches through oRPC, as pages do today.
2. **The same holds for metadata.** `generateMetadata` and `metadata` run on the server and
   their output (`<title>`, `<meta name="description">`, Open Graph tags) is in the HTML
   anyone can fetch. A project title in `generateMetadata` read straight from Prisma names
   drafts and other chapters' projects to anyone who guesses an id. Project pages therefore
   carry a generic server title and set the tab title in the browser once the project has
   loaded (`lib/hooks/useDocumentTitle.ts`).

Almost nothing in the app is anonymous. `projects.getById` needs a confirmed volunteer,
`volunteers.getById` an approved one, and the landing page says outright that projects are
for approved volunteers only. The public procedures are reference lists (skills, countries,
chapters, local groups) and the sign-in flows. So the pages the issue suggested starting
with, the project page and the volunteer profile, have no data a server render could show,
and their titles must stay generic.

## The pattern

A page that is the same for every reader, with a few viewer-specific parts:

- `page.tsx` is a server component: no `'use client'`, no hooks. It exports `metadata` (or
  `generateMetadata`) itself, so it needs no `layout.tsx` just to hold a title.
- Each viewer-specific part is a small client component beside it (`account-actions.tsx`)
  that reads `useAuth()` and renders nothing while the session loads. Pass it only plain,
  public props.
- Shared presentational components (`Heading`, `Text`, `TextLink`, `next/link`) have no
  hooks and render on the server as they are. Anything with state or handlers (`Button` with
  `onClick`) belongs in an island.

If a server component ever needs data from the database, read it through the router as an
anonymous caller rather than through Prisma, so the procedure's own permission check decides
what may be shown:

```ts
import { createRouterClient } from '@orpc/server'
import { createContext } from '@/server/context'
import { appRouter } from '@/server/router'

// No Authorization header: the caller is nobody, and every check treats it so.
export const anonymousApi = createRouterClient(appRouter, {
  context: () => createContext(new Request('http://server.internal')),
})
```

Nothing uses this yet, because no page renders data a public procedure returns.

## What converting a page buys

For `/privacy` (measured from `npm run build`; figures in the PR):

- The policy text is in the HTML. Before, the page returned `null` until the session had
  loaded, so the prerendered HTML held none of it: invisible without JavaScript and to
  crawlers, and blank until hydration for everyone.
- The route's own JavaScript shrinks to the two islands. The text no longer ships as JS.
- The title and description live in `page.tsx`.

What it does not buy: the shared bundle every route loads (React, the root layout's
providers and header, React Query, the oRPC client) is unchanged, and it is far larger than
any one page's code. Converting pages one by one trims each route's own chunk, not that.

## Which pages would benefit

Worth converting, in order: pages that are mostly text and look the same signed out.

- `/privacy`: done.
- `/people-for-a-pause-protest-journalist-outreach`: a public landing for a campaign, with a
  form; the copy could be server-rendered around a form island.
- `/forgot-password`, `/reset-password`, `/verify-email`, `/accept-invite`, `/login`: small,
  public, mostly a form. The gain is small; do them only alongside other work there.
- `/`: already a server component with a client call-to-action (`LandingCTA`).

Not worth converting while auth is a bearer token: every page behind `useRequireAuth`,
`useRequireApproved`, `useRequireConfirmed`, `useRequireStaff` or `useRequireAdmin` (the
project, task, profile, dashboard, inbox, settings, admin and triage pages). A server render
of them is empty by rule 1, so a server wrapper would only move the `'use client'` line down
one file.

## What moving auth to a cookie would unlock

With the session in an `HttpOnly` cookie, `cookies()` in a server component (or
`createContext` reading it) would know the viewer during the render. Then:

- Signed-in pages could fetch on the server through the router as the viewer, stream the
  result, and send HTML instead of a loading state, with React Query hydrated from it.
- `generateMetadata` could title a project page after the project for those allowed to see
  it, through the same `projects.getById` check.
- Redirects for signed-out visitors (`useRequireAuth`) could happen before any HTML is sent,
  in a `proxy.ts` (Next 16's name for middleware) or the page, removing the blank first paint.
- The token would no longer be readable by page scripts.

It would also bring work: CSRF protection for oRPC mutations (a `SameSite` cookie and an
origin check), the per-origin dev sign-in (`dev-*` tokens, `AGENTS.md`) moving to cookies,
API tokens and the MCP server keeping the bearer header, and dynamic rendering for every
signed-in page (no prerendered shell). That move is the decision that makes the rest of a
server/client split pay off.
