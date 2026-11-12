import { NextResponse, type NextRequest } from 'next/server'
import { canonicalRedirect } from '@/lib/canonical-host'
import { env } from '@/lib/env'

export function proxy(request: NextRequest): NextResponse {
  const target = canonicalRedirect(request.nextUrl, request.headers.get('host'), env.APP_URL)
  return target ? NextResponse.redirect(target, 308) : NextResponse.next()
}

export const config = {
  // /api stays on every host: the cron trigger, MCP clients and CSP reports POST there, and a
  // cross-origin redirect drops their Authorization header. /_next and /sw.js serve pages
  // already open on the legacy host, which can't load a script from another origin.
  matcher: ['/((?!api/|_next/|sw\\.js$).*)'],
}
