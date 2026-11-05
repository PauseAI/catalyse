import { prisma } from '@/lib/prisma'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'

const SINGLETON_ID = 1
// Real CSP violation reports are a few hundred bytes; reject anything implausibly large
// before parsing, so an unauthenticated caller can't use this endpoint to burn memory or
// flood Railway logs with an oversized payload.
const MAX_BODY_BYTES = 8_192

// URL fields in both report shapes: legacy `report-uri` (kebab-case) and Reporting API
// (camelCase). Their query strings and fragments can carry analytics IDs or reset tokens,
// and the logs sit outside GDPR export and deletion, so only origin and path are kept.
const URL_FIELDS = new Set([
  'blocked-uri',
  'document-uri',
  'referrer',
  'source-file',
  'blockedURL',
  'documentURL',
  'sourceFile',
])
// Excerpts of the blocked script or style, which can hold page content.
const SAMPLE_FIELDS = new Set(['script-sample', 'sample'])

function originAndPath(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    const url = new URL(value)
    if (url.origin !== 'null') return url.origin + url.pathname
  } catch {
    // A keyword such as 'inline' or 'eval', or a URL the browser reported unparseably.
  }
  return value.split(/[?#]/, 1)[0]
}

function redact(violation: unknown): unknown {
  if (typeof violation !== 'object' || violation === null || Array.isArray(violation)) {
    return violation
  }
  return Object.fromEntries(
    Object.entries(violation)
      .filter(([key]) => !SAMPLE_FIELDS.has(key))
      .map(([key, value]) => [key, URL_FIELDS.has(key) ? originAndPath(value) : value]),
  )
}

// Browsers POST here unauthenticated whenever the page's CSP (see next.config.ts) blocks
// something, per the `report-uri` directive. Redacted details go to Railway logs for
// debugging; only a running count is persisted, and jobs/csp-summary.ts digests it into
// a daily email so a burst of reports can't spam admins.
export async function POST(request: Request) {
  const { allowed, retryAfterMs } = checkRateLimit(request, 'csp-report', {
    limit: 30,
    windowMs: 60_000,
  })
  if (!allowed) return rateLimitResponse(retryAfterMs)

  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 })
  }

  let violation: unknown
  try {
    const payload = await request.json()
    violation = payload?.['csp-report'] ?? (Array.isArray(payload) ? payload[0]?.body : payload)
  } catch {
    // Malformed report body; still record that something was blocked.
  }

  console.error('[CSP VIOLATION]', JSON.stringify(redact(violation ?? {})))

  await prisma.platformSettings
    .update({ where: { id: SINGLETON_ID }, data: { cspViolationCount: { increment: 1 } } })
    .catch((e) => console.error('[CSP VIOLATION] Failed to record count:', e))

  return new Response(null, { status: 204 })
}
