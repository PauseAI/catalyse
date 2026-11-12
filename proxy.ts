import { NextResponse, type NextRequest } from 'next/server'
import { canonicalRedirect } from '@/lib/canonical-host'
import { env } from '@/lib/env'

export function proxy(request: NextRequest): NextResponse {
  const target = canonicalRedirect(request.nextUrl, request.headers.get('host'), env.APP_URL)
  if (!target) return NextResponse.next()
  const res = NextResponse.redirect(target, 308)
  // Browsers otherwise keep a permanent redirect indefinitely; a day bounds a wrong APP_URL.
  res.headers.set('Cache-Control', 'public, max-age=86400')
  return res
}

export const config = {
  // /api stays on every host: the cron trigger, MCP clients and CSP reports POST there, and a
  // cross-origin redirect drops their Authorization header. /_next, /sw.js and /offline.html
  // serve pages and the service worker already running on the legacy host, which can't fetch
  // them from another origin.
  matcher: [
    {
      source: '/((?!api/|_next/|sw\\.js$|offline\\.html$).*)',
      has: [{ type: 'host', value: 'catalyse.up.railway.app' }],
    },
  ],
}
